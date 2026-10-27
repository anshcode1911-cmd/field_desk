import { ChargeBalance } from './accounts.model.js';
import { CreditBalance } from '../credits/credits.model.js';
import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  CustomerSummary,
  LedgerView,
  CustomerAccountRow,
} from '@crm/shared/crm';
import { CustomersRepository } from '../customers/customers.repository.js';
import { AccountsRepository } from '../accounts/accounts.repository.js';
import { RewardsService } from '../rewards/rewards.service.js';
import { CreditsRepository } from '../credits/credits.repository.js';
import { RewardsRepository } from '../rewards/rewards.repository.js';
import { ReturnsRepository } from '../returns/returns.repository.js';
import { FulfillmentRepository } from '../fulfillment/fulfillment.repository.js';
import { DatabaseService } from '../database/database.service.js';
import type { ActionContext as Context, Payload } from '../common/domain.js';
import { authorize, useCustomer, fail, safe } from '../common/domain.js';

@Injectable()
export class AccountsService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly accountsRepository: AccountsRepository,
    private readonly rewardsService: RewardsService,
    private readonly creditsRepository: CreditsRepository,
    private readonly rewardsRepository: RewardsRepository,
    private readonly returnsRepository: ReturnsRepository,
    private readonly fulfillmentRepository: FulfillmentRepository,
    private readonly database: DatabaseService,
  ) {}
  receive(c: Context, p: Payload<'RECEIVE_CUSTOMER_PAYMENT'>) {
    authorize(c, 'ACCOUNTS', 'ADMIN');
    useCustomer(c, this.customersRepository.findById(p.customerId));
    const receiptId = randomUUID();
    c.references.receiptId = receiptId;
    this.accountsRepository.insertReceipt(c, {
      id: receiptId,
      customer_id: c.customerId,
      amount_paise: p.amountPaise,
      reference: p.reference,
      action_id: c.id,
      created_at: c.now,
    });

    this.allocateCash(c);

    this.rewardsService.refresh(c);
  }
  allocate(c: Context, p: Payload<'ALLOCATE_PAYMENT'>) {
    authorize(c, 'ACCOUNTS', 'ADMIN');
    useCustomer(c, this.customersRepository.findById(p.customerId));

    this.allocateCash(c);

    this.rewardsService.refresh(c);
  }
  /** FDSK-169, written in the original service style (Solution B). */
  movePayment(c: Context, p: Payload<'MOVE_PAYMENT'>) {
    authorize(c, 'ACCOUNTS', 'ADMIN');
    const from = useCustomer(
      c,
      this.customersRepository.findById(p.customerId),
    );
    const receipt = this.accountsRepository.findCustomerReceipt(
      p.receiptId,
      from.id,
    );
    if (!receipt)
      fail('RECEIPT_NOT_FOUND', 'Select a receipt recorded for this customer');
    if (p.toCustomerId === from.id)
      fail('SAME_CUSTOMER', 'Choose the customer who actually paid');
    const to = this.customersRepository.findById(p.toCustomerId);
    if (!to) fail('CUSTOMER_NOT_FOUND', 'The paying customer was not found');
    const received =
      receipt.amount_paise -
      this.accountsRepository.movedOutFromReceipt(receipt.id);
    if (!received)
      fail('RECEIPT_ALREADY_MOVED', 'This receipt was already moved');
    const funds = this.creditsRepository.fundsFromReceipt(receipt.id);
    if (funds.length)
      fail(
        'RECEIPT_FUNDS_CREDIT',
        `This payment funds credit note(s) ${[...new Set(funds.map((fund) => fund.credit_note_id))].join(', ')}. Credit cannot move between customers (CUS-001) and the rules define no way to withdraw its funding, so the payment cannot be moved automatically.`,
      );
    for (const allocation of this.accountsRepository.allocationsByChargeForReceipt(
      receipt.id,
    ))
      this.accountsRepository.insertAllocation(c, {
        id: randomUUID(),
        customer_id: from.id,
        receipt_id: receipt.id,
        charge_id: allocation.charge_id,
        amount_paise: -allocation.n,
        action_id: c.id,
        created_at: c.now,
      });
    const newReceiptId = randomUUID();
    this.accountsRepository.insertReceipt(c, {
      id: newReceiptId,
      customer_id: to.id,
      amount_paise: received,
      reference: receipt.reference,
      action_id: c.id,
      created_at: c.now,
    });
    this.accountsRepository.insertTransfer(c, {
      id: randomUUID(),
      receipt_id: receipt.id,
      from_customer_id: from.id,
      to_customer_id: to.id,
      new_receipt_id: newReceiptId,
      amount_paise: received,
      reason: p.reason,
      reference: p.reference,
      action_id: c.id,
      created_at: c.now,
    });
    c.references.movedReceiptId = receipt.id;
    c.references.receiptId = newReceiptId;
    // Points earned from the moved cash are recovered from the wrong customer.
    this.rewardsService.refresh(c);
    // The right customer received a payment (a WF-002 allocation occasion).
    c.customerId = to.id;
    c.alsoAffects = [from.id];
    this.allocateCash(c);
    this.rewardsService.refresh(c);
  }
  allocateCash(c: Context) {
    for (const receipt of this.accountsRepository.receiptsForCustomer(
      c.customerId,
    )) {
      let available =
        receipt.amount_paise -
        this.accountsRepository.movedOutFromReceipt(receipt.id) -
        this.accountsRepository.allocatedFromReceipt(receipt.id) -
        this.creditsRepository.reservedFromReceipt(receipt.id);
      if (available < 0)
        fail('RECEIPT_MISMATCH', 'Receipt allocations exceed captured funds');
      for (const charge of this.accountsRepository.chargesInDueOrder(
        c.customerId,
      )) {
        if (!available) break;
        const face =
          charge.amount_paise +
          this.accountsRepository.adjustmentsForCharge(charge.id);
        const cash = this.accountsRepository.cashForCharge(charge.id);
        const credit = this.creditsRepository.appliedToCharge(charge.id);
        const redeemed = this.rewardsRepository.redeemedForCharge(charge.id);
        const take = Math.min(
          available,
          Math.max(0, face - cash - credit - redeemed),
        );
        if (take)
          this.accountsRepository.insertAllocation(c, {
            id: randomUUID(),
            customer_id: c.customerId,
            receipt_id: receipt.id,
            charge_id: charge.id,
            amount_paise: take,
            action_id: c.id,
            created_at: c.now,
          });
        available -= take;
      }
    }
  }
  summary(customerId: string): CustomerSummary {
    const customer = this.customersRepository.findById(customerId);
    if (!customer) throw new NotFoundException('Customer not found');
    const charges = this.accountsRepository
      .chargesForCustomer(customerId)
      .map((charge) => {
        const remainingPaise =
          charge.amount_paise +
          this.accountsRepository.adjustmentsForCharge(charge.id);
        const cashPaidPaise = this.accountsRepository.cashForCharge(charge.id);
        const credit = this.creditsRepository.appliedToCharge(charge.id);
        const redeemed = this.rewardsRepository.redeemedForCharge(charge.id);
        return {
          ...charge,
          remainingPaise,
          cashPaidPaise,
          outstandingPaise: new ChargeBalance(
            remainingPaise,
            cashPaidPaise,
            credit,
            redeemed,
          ).outstandingPaise,
        };
      });
    const credits = this.creditsRepository
      .creditsForCustomer(customerId)
      .map((note) => {
        const appliedPaise = this.creditsRepository.appliedFromCredit(note.id);
        const refundedPaise = this.creditsRepository.refundedFromCredit(
          note.id,
        );
        return {
          ...note,
          appliedPaise,
          refundedPaise,
          availablePaise: new CreditBalance(
            note.amount_paise,
            appliedPaise,
            refundedPaise,
          ).availablePaise,
        };
      });
    const receipts = this.accountsRepository.receiptsByInsertion(customerId);
    const unappliedCashPaise = safe(
      receipts.reduce(
        (sum, receipt) =>
          sum +
          receipt.amount_paise -
          this.accountsRepository.movedOutFromReceipt(receipt.id) -
          this.accountsRepository.allocatedFromReceipt(receipt.id) -
          this.creditsRepository.reservedFromReceipt(receipt.id),
        0,
      ),
    );
    const receivedPaise =
      this.accountsRepository.receivedForCustomer(customerId);
    const refundsPaise = this.creditsRepository.refundedForCustomer(customerId);
    const redemption = this.rewardsRepository.redeemedForCustomer(customerId);
    const netBalancePaise = safe(
      this.accountsRepository.postedForCustomer(customerId) -
        receivedPaise +
        refundsPaise -
        redemption,
    );
    return {
      customer,
      charges,
      credits,
      netBalancePaise,
      unappliedCashPaise,
      receivedPaise,
      refundsPaise,
      outstandingPaise: safe(
        charges.reduce((sum, row) => sum + row.outstandingPaise, 0),
      ),
      creditsOpenPaise: safe(
        credits.reduce((sum, row) => sum + row.availablePaise, 0),
      ),
      points: this.rewardsService.balances(customerId),
    };
  }
  ledger(customerId: string): LedgerView {
    this.summary(customerId);
    return {
      finance: this.accountsRepository.entriesForCustomer(customerId),
      receipts: this.accountsRepository.receiptsByInsertion(customerId),
      transfers: this.accountsRepository.transfersForCustomer(customerId),
      allocations: this.accountsRepository.allocationsForCustomer(customerId),
      creditApplications:
        this.creditsRepository.applicationsForCustomer(customerId),
      credits: this.creditsRepository.creditsForCustomer(customerId),
      refunds: this.creditsRepository.refundsForCustomer(customerId),
      redemptions: this.rewardsRepository.redemptionsForCustomer(customerId),
      rewards: this.rewardsRepository.entriesForCustomer(customerId),
      returns: this.returnsRepository.forCustomer(customerId),
      corrections:
        this.fulfillmentRepository.correctionsForCustomer(customerId),
    };
  }
  accounts(): CustomerAccountRow[] {
    return this.database.db.transaction(() =>
      this.customersRepository.list().map((customer) => {
        const summary = this.summary(customer.id);
        return {
          customer,
          netBalancePaise: summary.netBalancePaise,
          outstandingPaise: summary.outstandingPaise,
          unappliedCashPaise: summary.unappliedCashPaise,
          creditsOpenPaise: summary.creditsOpenPaise,
        };
      }),
    );
  }
}
