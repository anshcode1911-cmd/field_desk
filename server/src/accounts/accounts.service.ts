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
import { SettlementService } from '../settlement/settlement.service.js';
import type { ActionContext as Context, Payload } from '../common/domain.js';
import {
  useCustomer,
  fail,
  safe,
  DomainDecision as Decision,
} from '../common/domain.js';

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
    private readonly settlement: SettlementService,
  ) {}
  receive(c: Context, p: Payload<'RECEIVE_CUSTOMER_PAYMENT'>) {
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
  }
  allocate(c: Context, p: Payload<'ALLOCATE_PAYMENT'>) {
    useCustomer(c, this.customersRepository.findById(p.customerId));
  }
  /**
   * FDSK-169. Release everything the receipt settled at the wrong customer,
   * then record the same money as a new, linked receipt at the right one.
   * The right customer becomes the action's subject, so the rulebook's
   * "allocate free cash" applies there (a receipt is a WF-002 occasion);
   * rewards are refreshed for both.
   */
  movePayment(c: Context, p: Payload<'MOVE_PAYMENT'>) {
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
    const { received } = this.settlement.receipt(receipt);
    if (!received)
      fail('RECEIPT_ALREADY_MOVED', 'This receipt was already moved');
    const transferId = randomUUID();
    this.withdrawCreditFunding(c, p, from.name, receipt.id, transferId);
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
      id: transferId,
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
    c.customerId = to.id;
    c.alsoAffects = [from.id];
  }
  /**
   * Credit funded by the moved payment cannot stay with the wrong customer
   * (CUS-001). Unused funding is withdrawn by a linked negative entry, but
   * only once Accounts confirms, because it removes credit the customer can
   * see. Funding that was already applied or refunded must first be reversed
   * with the existing reversal actions.
   */
  private withdrawCreditFunding(
    c: Context,
    p: Payload<'MOVE_PAYMENT'>,
    customerName: string,
    receiptId: string,
    transferId: string,
  ) {
    const fundings =
      this.creditsRepository.fundingByCreditForReceipt(receiptId);
    if (!fundings.length) return;
    const used = fundings.filter(
      (funding) =>
        this.creditsRepository.refundedFromReceipt(
          funding.credit_note_id,
          receiptId,
        ) > 0 ||
        this.settlement.credit({ id: funding.credit_note_id }).availablePaise <
          funding.n,
    );
    if (used.length)
      fail(
        'RECEIPT_FUNDS_CREDIT',
        `This payment funds credit that has already been applied or refunded (credit note ${used.map((funding) => funding.credit_note_id).join(', ')}). Credit cannot move between customers (CUS-001): reverse those applications or refunds first, then move the payment.`,
      );
    const total = safe(fundings.reduce((sum, funding) => sum + funding.n, 0));
    if (p.creditFunding !== 'WITHDRAW')
      throw new Decision(
        [
          {
            key: 'creditFunding',
            prompt: `This payment funds ${total} paise of unused credit for ${customerName}. Moving it withdraws that credit, because credit cannot move between customers (CUS-001).`,
            options: [
              {
                id: 'WITHDRAW',
                label: 'Withdraw the unused credit and move the payment',
              },
            ],
          },
        ],
        'Confirm withdrawing the credit this payment funds',
      );
    for (const funding of fundings)
      this.creditsRepository.insertFunding(c, {
        id: randomUUID(),
        credit_note_id: funding.credit_note_id,
        receipt_id: receiptId,
        amount_paise: -funding.n,
        transfer_id: transferId,
      });
  }
  allocateCash(c: Context, customerId = c.customerId) {
    for (const receipt of this.accountsRepository.receiptsForCustomer(
      customerId,
    )) {
      let available = this.settlement.receipt(receipt).free;
      if (available < 0)
        fail('RECEIPT_MISMATCH', 'Receipt allocations exceed captured funds');
      for (const charge of this.accountsRepository.chargesInDueOrder(
        customerId,
      )) {
        if (!available) break;
        const take = Math.min(
          available,
          Math.max(0, this.settlement.charge(charge).outstandingPaise),
        );
        if (take)
          this.accountsRepository.insertAllocation(c, {
            id: randomUUID(),
            customer_id: customerId,
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
        const balance = this.settlement.charge(charge);
        return {
          ...charge,
          remainingPaise: balance.retainedPaise,
          cashPaidPaise: balance.cashPaise,
          outstandingPaise: balance.outstandingPaise,
        };
      });
    const credits = this.creditsRepository
      .creditsForCustomer(customerId)
      .map((note) => {
        const balance = this.settlement.credit(note);
        return {
          ...note,
          appliedPaise: balance.appliedPaise,
          refundedPaise: balance.refundedPaise,
          availablePaise: balance.availablePaise,
        };
      });
    const receipts = this.accountsRepository
      .receiptsByInsertion(customerId)
      .map((receipt) => this.settlement.receipt(receipt));
    const unappliedCashPaise = safe(
      receipts.reduce((sum, receipt) => sum + receipt.free, 0),
    );
    const receivedPaise = safe(
      receipts.reduce((sum, receipt) => sum + receipt.received, 0),
    );
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
