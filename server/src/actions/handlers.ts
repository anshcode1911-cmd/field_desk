import type { CommandType, CrmCommand } from '@crm/shared/crm';
import type { Reaction } from '@crm/shared/rulebook';
import type { ActionContext as Context, Payload } from '../common/domain.js';
import type { CustomersService } from '../customers/customers.service.js';
import type { OrdersService } from '../orders/orders.service.js';
import type { FulfillmentService } from '../fulfillment/fulfillment.service.js';
import type { ReturnsService } from '../returns/returns.service.js';
import type { AccountsService } from '../accounts/accounts.service.js';
import type { RewardsService } from '../rewards/rewards.service.js';
import type { CreditsService } from '../credits/credits.service.js';

/** Domain services that own each action's own writes. */
export interface DomainServices {
  customers: CustomersService;
  orders: OrdersService;
  fulfillment: FulfillmentService;
  returns: ReturnsService;
  accounts: AccountsService;
  rewards: RewardsService;
  credits: CreditsService;
}

type Handler<T extends CommandType> = (
  s: DomainServices,
  c: Context,
  p: Payload<T>,
) => void;

/**
 * Binds every rulebook action to the domain method that records its facts.
 * Permissions and follow-up policies are not repeated here: the dispatcher
 * reads them from `RULEBOOK`.
 */
const HANDLERS: { [T in CommandType]: Handler<T> } = {
  UPDATE_CUSTOMER: (s, c, p) => s.customers.updateCustomer(c, p),
  PUNCH_ORDER: (s, c, p) => s.orders.punch(c, p),
  EDIT_ORDER: (s, c, p) => s.orders.edit(c, p),
  SUBMIT_ORDER: (s, c, p) => s.orders.submit(c, p),
  APPROVE_ORDER: (s, c, p) => s.orders.approve(c, p),
  REJECT_ORDER: (s, c, p) => s.orders.reject(c, p),
  CANCEL_REMAINDER: (s, c, p) => s.orders.cancel(c, p),
  START_LOADING: (s, c, p) => s.fulfillment.load(c, p),
  DISPATCH_SHIPMENT: (s, c, p) => s.fulfillment.dispatch(c, p),
  CONFIRM_DELIVERY: (s, c, p) => s.fulfillment.deliver(c, p),
  CORRECT_DELIVERY: (s, c, p) => s.fulfillment.correctDelivery(c, p),
  RECORD_RETURN: (s, c, p) => s.returns.returnItems(c, p),
  CORRECT_DISPATCHED_ORDER: (s, c, p) => s.fulfillment.correct(c, p),
  RECEIVE_CUSTOMER_PAYMENT: (s, c, p) => s.accounts.receive(c, p),
  ALLOCATE_PAYMENT: (s, c, p) => s.accounts.allocate(c, p),
  MOVE_PAYMENT: (s, c, p) => s.accounts.movePayment(c, p),
  REDEEM_POINTS: (s, c, p) => s.rewards.redeem(c, p),
  ISSUE_CREDIT_NOTE: (s, c, p) => s.credits.issueCredit(c, p),
  APPLY_CREDIT_NOTE: (s, c, p) => s.credits.applyCredit(c, p),
  REFUND_CREDIT_NOTE: (s, c, p) => s.credits.refundCredit(c, p),
  REVERSE_CREDIT_APPLICATION: (s, c, p) =>
    s.credits.reverseCreditApplication(c, p),
  REVERSE_CREDIT_REFUND: (s, c, p) => s.credits.reverseCreditRefund(c, p),
};

/** Implementations of the rulebook's follow-up policies. */
export const REACTION_HANDLERS: Record<
  Reaction,
  (s: DomainServices, c: Context, customerId: string) => void
> = {
  'allocate free cash': (s, c, customerId) =>
    s.accounts.allocateCash(c, customerId),
  'refresh rewards': (s, c, customerId) => s.rewards.refresh(c, customerId),
};

export function runHandler(s: DomainServices, c: Context, command: CrmCommand) {
  // TypeScript cannot correlate `type` and `payload` through an indexed
  // lookup; the mapped type above already guarantees they match.
  const handler = HANDLERS[command.type] as Handler<CommandType>;
  handler(s, c, command.payload as never);
}
