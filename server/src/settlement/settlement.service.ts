import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AccountsRepository } from '../accounts/accounts.repository.js';
import { CreditsRepository } from '../credits/credits.repository.js';
import { RewardsRepository } from '../rewards/rewards.repository.js';
import { ChargeBalance } from '../accounts/accounts.model.js';
import type { Receipt, ReceivableEntry } from '../accounts/accounts.model.js';
import type { ActionContext as Context } from '../common/domain.js';
import { fail, safe } from '../common/domain.js';

/**
 * The one place that answers "how is this charge settled?" and "how much of
 * this receipt is still free?", and that releases settlement when a charge
 * shrinks. Accounts, Credits, Rewards, Returns and Fulfillment use it instead
 * of repeating the arithmetic.
 */
@Injectable()
export class SettlementService {
  constructor(
    private readonly accountsRepository: AccountsRepository,
    private readonly creditsRepository: CreditsRepository,
    private readonly rewardsRepository: RewardsRepository,
  ) {}

  /** ACC-001: v = retained value; c, k, z = cash, credit, points; b = v − c − k − z. */
  charge(charge: ReceivableEntry) {
    return new ChargeBalance(
      safe(
        charge.amount_paise +
          this.accountsRepository.adjustmentsForCharge(charge.id),
      ),
      this.accountsRepository.cashForCharge(charge.id),
      this.creditsRepository.appliedToCharge(charge.id),
      this.rewardsRepository.redeemedForCharge(charge.id),
    );
  }

  /**
   * ACC-002: m = received, a = allocated, f = reserved as credit, u = m − a − f.
   * A receipt moved to another customer (FDSK-169) keeps its record but no
   * longer counts as received here.
   */
  receipt(receipt: Receipt) {
    const received = safe(
      receipt.amount_paise -
        this.accountsRepository.movedOutFromReceipt(receipt.id),
    );
    const allocated = this.accountsRepository.allocatedFromReceipt(receipt.id);
    const reserved = this.creditsRepository.reservedFromReceipt(receipt.id);
    return {
      received,
      allocated,
      reserved,
      free: safe(received - allocated - reserved),
    };
  }

  /**
   * WF-003 release: after a charge's retained value is reduced, release the
   * settlement that now exceeds it — cash, then credit, then points. Within
   * cash or credit, sources are visited in reverse order of their first
   * allocation/application. Each amount returns to its original source.
   *
   * @param sourceId the document that reduced the charge (a return or a
   *   delivery correction); restored points cite it.
   * @returns cash released per receipt, in release order, for the caller to
   *   reapply or reserve.
   */
  releaseOverSettlement(c: Context, charge: ReceivableEntry, sourceId: string) {
    const released = new Map<string, number>();
    const balance = this.charge(charge);
    let overage = Math.max(0, -balance.outstandingPaise);
    for (const allocation of this.accountsRepository.cashByReceiptForCharge(
      charge.id,
    )) {
      const take = Math.min(overage, allocation.n);
      if (!take) continue;
      this.accountsRepository.insertAllocation(c, {
        id: randomUUID(),
        customer_id: charge.customer_id,
        receipt_id: allocation.receipt_id,
        charge_id: charge.id,
        amount_paise: -take,
        action_id: c.id,
        created_at: c.now,
      });
      released.set(
        allocation.receipt_id,
        (released.get(allocation.receipt_id) ?? 0) + take,
      );
      overage -= take;
    }
    for (const application of this.creditsRepository.creditByNoteForCharge(
      charge.id,
    )) {
      const take = Math.min(overage, application.n);
      if (!take) continue;
      this.creditsRepository.insertApplication(c, {
        id: randomUUID(),
        customer_id: charge.customer_id,
        credit_note_id: application.credit_note_id,
        charge_id: charge.id,
        amount_paise: -take,
        action_id: c.id,
        created_at: c.now,
      });
      overage -= take;
    }
    if (overage > 0) {
      if (overage > balance.points)
        fail(
          'SETTLEMENT_MISMATCH',
          'The charge cannot be settled against its source documents',
        );
      this.restorePoints(c, charge, overage, sourceId);
    }
    return released;
  }

  private restorePoints(
    c: Context,
    charge: ReceivableEntry,
    points: number,
    sourceId: string,
  ) {
    this.rewardsRepository.insertRedemption(c, {
      id: randomUUID(),
      customer_id: charge.customer_id,
      charge_id: charge.id,
      points: -points,
      action_id: c.id,
      created_at: c.now,
    });
    for (const [bucket, delta] of [
      ['AVAILABLE', points],
      ['REDEEMED', -points],
    ] as const)
      this.rewardsRepository.insertPosting(c, {
        id: randomUUID(),
        customer_id: charge.customer_id,
        line_key: null,
        bucket,
        points_delta: delta,
        source_id: sourceId,
        action_id: c.id,
        created_at: c.now,
      });
  }
}
