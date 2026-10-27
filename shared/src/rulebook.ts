import type { Role } from './roles.js';
import type { CommandType } from './crm.js';

/**
 * The FieldDesk rulebook: one entry per business action.
 *
 * Read each entry as "WHO may do it, WHAT it does, and THEN which follow-up
 * policies run". Rule ids refer to
 * docs/candidate-walkthrough/canonical_business_rules.md.
 *
 * Admin may perform every action (business terms, "Roles and actions"), so
 * `who` lists only the other roles. The server enforces `who` and runs
 * `then`; the client uses `can()` to show only permitted actions;
 * `pnpm rules:doc` renders this file as docs/solution/RULES.md.
 */

/**
 * Follow-up policies. They always run in this order, after the action's own
 * changes, and they never trigger each other: physical and financial facts
 * first, then cash allocation, then the reward points derived from cash.
 */
export const REACTIONS = {
  'allocate free cash': {
    rules: ['ACC-003', 'WF-002'],
    says: 'Apply unallocated customer cash to outstanding charges, oldest first.',
    /** An allocation occasion belongs to the customer the action is about. */
    scope: 'subject',
  },
  'refresh rewards': {
    rules: ['REW-001', 'REW-002', 'REW-003'],
    says: 'Recompute locked, earned and clawback points from approved quantities and cash, and post only the difference.',
    /** Points are derived values, so every customer whose books changed is refreshed. */
    scope: 'every affected customer',
  },
} as const satisfies Record<
  string,
  {
    rules: readonly string[];
    says: string;
    scope: 'subject' | 'every affected customer';
  }
>;
export type Reaction = keyof typeof REACTIONS;
export const REACTION_ORDER = Object.keys(REACTIONS) as Reaction[];

export interface ActionRule {
  /** Canonical rule ids this action implements. */
  readonly rules: readonly string[];
  /** Roles permitted besides Admin. */
  readonly who: readonly Exclude<Role, 'ADMIN'>[];
  /** One plain-English sentence describing the outcome. */
  readonly says: string;
  /** Follow-up policies (WF-002 lists which actions allocate cash). */
  readonly then: readonly Reaction[];
}

export const RULEBOOK = {
  UPDATE_CUSTOMER: {
    rules: [],
    who: ['SALES', 'ACCOUNTS'],
    says: 'Change a customer’s name or unique code.',
    then: [],
  },
  PUNCH_ORDER: {
    rules: ['ORD-005', 'CAT-002'],
    who: ['SALES'],
    says: 'Create a draft order at agreed prices and current catalog points rates.',
    then: [],
  },
  EDIT_ORDER: {
    rules: ['ORD-003', 'ORD-005', 'ORD-006'],
    who: ['SALES'],
    says: 'Replace the commercial terms with a new revision, only before any dispatch or cancellation; approved orders need reapproval and loading batches are voided.',
    then: [],
  },
  SUBMIT_ORDER: {
    rules: ['ORD-005'],
    who: ['SALES'],
    says: 'Send the current revision for KAM review.',
    then: [],
  },
  APPROVE_ORDER: {
    rules: ['ORD-005', 'REW-001'],
    who: ['KAM'],
    says: 'Approve exactly the current revision; its reward entitlement becomes locked points.',
    then: [],
  },
  REJECT_ORDER: {
    rules: ['ORD-005'],
    who: ['KAM'],
    says: 'Reject exactly the current revision, with a reason.',
    then: [],
  },
  CANCEL_REMAINDER: {
    rules: ['ORD-004', 'ORD-005', 'ORD-006'],
    who: ['SALES'],
    says: 'Cancel selected or all unshipped units, with a reason; loading batches are voided.',
    then: ['refresh rewards'],
  },
  START_LOADING: {
    rules: ['FUL-003', 'FUL-004'],
    who: ['WAREHOUSE'],
    says: 'Reserve open units of the approved current revision in a loading batch.',
    then: [],
  },
  DISPATCH_SHIPMENT: {
    rules: ['FUL-003', 'FUL-005'],
    who: ['WAREHOUSE'],
    says: 'Dispatch a whole loading batch that names the approved current revision.',
    then: [],
  },
  CONFIRM_DELIVERY: {
    rules: ['FUL-006', 'WF-005'],
    who: ['WAREHOUSE'],
    says: 'Confirm some or all dispatched units as delivered; each confirmation creates exactly one goods charge.',
    then: ['allocate free cash', 'refresh rewards'],
  },
  CORRECT_DELIVERY: {
    rules: ['FUL-001', 'FUL-006', 'WF-001', 'WF-003', 'WF-005'],
    who: ['KAM'],
    says: 'Lower an overstated delivered quantity to what actually arrived, with a reason and evidence: the newest confirmations are reversed by linked entries, their charges reduced, excess settlement released back to its sources, and the shipment reopened so Warehouse can confirm the rest later. Freed cash stays unapplied until the next allocation occasion.',
    then: ['refresh rewards'],
  },
  RECORD_RETURN: {
    rules: ['RET-001', 'RET-002', 'WF-003'],
    who: ['WAREHOUSE'],
    says: 'Receive delivered units back with an explicit deduction; reduce their charges, release excess settlement to its sources, charge the deduction and keep remaining released cash as credit.',
    then: ['allocate free cash', 'refresh rewards'],
  },
  CORRECT_DISPATCHED_ORDER: {
    rules: ['WF-004', 'WF-005'],
    who: ['KAM'],
    says: 'Record authorized additional goods that were physically dispatched, with evidence; asks which dispatch they left on.',
    then: ['allocate free cash', 'refresh rewards'],
  },
  RECEIVE_CUSTOMER_PAYMENT: {
    rules: ['ACC-002', 'WF-002'],
    who: ['ACCOUNTS'],
    says: 'Record money received from a customer.',
    then: ['allocate free cash', 'refresh rewards'],
  },
  ALLOCATE_PAYMENT: {
    rules: ['ACC-003', 'WF-002'],
    who: ['ACCOUNTS'],
    says: 'Explicitly apply the customer’s unallocated cash.',
    then: ['allocate free cash', 'refresh rewards'],
  },
  MOVE_PAYMENT: {
    rules: ['CUS-001', 'WF-001', 'ACC-002', 'ACC-003', 'WF-002', 'REW-003'],
    who: ['ACCOUNTS'],
    says: 'Move a payment recorded against the wrong customer, with a reason and the bank reference that proves the payer: the wrong customer’s settlements from it are released (their charges reopen and points earned from it are recovered), and the same money is received and applied at the right customer. Refused while the payment funds credit, because credit cannot cross accounts.',
    then: ['allocate free cash', 'refresh rewards'],
  },
  REDEEM_POINTS: {
    rules: ['REW-004'],
    who: ['SALES', 'ACCOUNTS'],
    says: 'Settle a selected charge with available points (one point = one paise), only when no clawback is pending.',
    then: [],
  },
  ISSUE_CREDIT_NOTE: {
    rules: ['CRD-001', 'CRD-002', 'CRD-006'],
    who: ['ACCOUNTS'],
    says: 'Reserve unallocated cash as an explicit credit note, with a reason.',
    then: [],
  },
  APPLY_CREDIT_NOTE: {
    rules: ['CRD-003'],
    who: ['ACCOUNTS'],
    says: 'Settle a selected charge with open credit.',
    then: [],
  },
  REFUND_CREDIT_NOTE: {
    rules: ['CRD-004'],
    who: ['ACCOUNTS'],
    says: 'Record a payout of open credit against its funding receipts, with a bank reference.',
    then: [],
  },
  REVERSE_CREDIT_APPLICATION: {
    rules: ['CRD-005', 'CRD-006'],
    who: ['ACCOUNTS'],
    says: 'Undo part or all of a credit application with a linked negative entry.',
    then: [],
  },
  REVERSE_CREDIT_REFUND: {
    rules: ['CRD-005', 'CRD-006'],
    who: ['ACCOUNTS'],
    says: 'Undo part or all of a recorded refund with a linked negative entry and a bank reference.',
    then: [],
  },
} as const satisfies Record<CommandType, ActionRule>;

/**
 * A lifecycle is a first-hit decision table. Read each row as
 * "OPERATION from any of these statuses leads to STATUS". The first row
 * whose operation and starting status match decides; when no row matches,
 * the operation is not allowed in that status.
 */
export interface Lifecycle<Status extends string, Operation extends string> {
  readonly rule: string;
  readonly rows: ReadonlyArray<
    readonly [operation: Operation, from: readonly Status[], to: Status]
  >;
}

export type OrderStatus =
  | 'DRAFT'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'REAPPROVAL_REQUIRED'
  | 'CANCELLED';
const OPEN_ORDER = [
  'DRAFT',
  'PENDING',
  'APPROVED',
  'REJECTED',
  'REAPPROVAL_REQUIRED',
] as const satisfies OrderStatus[];

export const ORDER_LIFECYCLE = {
  rule: 'ORD-005',
  rows: [
    ['edit', ['APPROVED', 'REAPPROVAL_REQUIRED'], 'REAPPROVAL_REQUIRED'],
    ['edit', ['DRAFT', 'PENDING', 'REJECTED'], 'DRAFT'],
    ['submit', ['DRAFT', 'REJECTED'], 'PENDING'],
    ['submit', ['REAPPROVAL_REQUIRED'], 'REAPPROVAL_REQUIRED'],
    ['approve', ['PENDING', 'REAPPROVAL_REQUIRED'], 'APPROVED'],
    ['reject', ['PENDING', 'REAPPROVAL_REQUIRED'], 'REJECTED'],
    ['cancel every unit, none dispatched', OPEN_ORDER, 'CANCELLED'],
    ['record additional dispatched goods', ['APPROVED'], 'APPROVED'],
  ],
} as const satisfies Lifecycle<OrderStatus, string>;

export type ShipmentStatus = 'LOADING' | 'DISPATCHED' | 'DELIVERED' | 'VOIDED';
export const SHIPMENT_LIFECYCLE = {
  rule: 'FUL-004..006',
  rows: [
    ['dispatch', ['LOADING'], 'DISPATCHED'],
    ['confirm some dispatched units', ['DISPATCHED'], 'DISPATCHED'],
    ['confirm the last undelivered units', ['DISPATCHED'], 'DELIVERED'],
    ['void after an order change', ['LOADING'], 'VOIDED'],
    [
      'correct an overstated delivery',
      ['DISPATCHED', 'DELIVERED'],
      'DISPATCHED',
    ],
  ],
} as const satisfies Lifecycle<ShipmentStatus, string>;

/** The status `operation` leads to from `from`, or undefined if not allowed. */
export function nextStatus<L extends Lifecycle<string, string>>(
  lifecycle: L,
  operation: L['rows'][number][0],
  from: string,
): L['rows'][number][2] | undefined {
  const row = lifecycle.rows.find(
    ([op, starts]) => op === operation && starts.includes(from),
  );
  return row?.[2];
}

/**
 * Consistency checks run for every affected customer before an action
 * commits. Any failure rolls the whole action back (ACCOUNT_INCONSISTENT),
 * so no action can leave the books in a state these sentences forbid.
 */
export const INVARIANTS = {
  approval: {
    rules: ['ORD-005'],
    says: 'An approved order carries an approval of its current revision.',
  },
  quantities: {
    rules: ['ORD-001', 'FUL-001'],
    says: 'Per order line: ordered = canceled + dispatched + open; returned ≤ delivered ≤ dispatched; loading ≤ open.',
  },
  'reward-accrual': {
    rules: ['REW-001', 'REW-002'],
    says: 'Per approved line, earned and locked points match qualifying cash and retained units.',
  },
  shipment: {
    rules: ['FUL-003'],
    says: 'Every live shipment uses an approved revision; loading batches use the current one.',
  },
  'shipment-quantities': {
    rules: ['FUL-001'],
    says: 'Per shipment line: returned ≤ delivered ≤ dispatched ≤ loaded.',
  },
  'delivery-charge': {
    rules: ['WF-005'],
    says: 'Each delivery confirmation, and each correction of one, has exactly one charge entry worth quantity × shipment price.',
  },
  'recognized-value': {
    rules: ['WF-005', 'RET-002'],
    says: 'Posted charges = delivered goods − returned goods + return deductions.',
  },
  settlement: {
    rules: ['ACC-001'],
    says: 'Each charge’s cash, credit, points and outstanding amount are non-negative.',
  },
  cash: {
    rules: ['ACC-002'],
    says: 'Each receipt’s money is allocated or reserved at most once.',
  },
  credit: {
    rules: ['CRD-001'],
    says: 'Each credit note is fully receipt-funded and within its application and refund limits.',
  },
  'reward-conservation': {
    rules: ['REW-003'],
    says: 'Locked + available + redeemed − clawback pending = retained entitlement; points are never available while clawback is pending.',
  },
  'redemption-evidence': {
    rules: ['REW-004'],
    says: 'Redeemed points equal the recorded point settlements.',
  },
  'account-position': {
    rules: ['ACC-001', 'ACC-002', 'CRD-001'],
    says: 'Net balance = outstanding charges − unapplied cash − open credit.',
  },
  'activity-uniqueness': {
    rules: ['WF-001'],
    says: 'Each applied activity has exactly one audit event.',
  },
} as const satisfies Record<string, { rules: string[]; says: string }>;
export type InvariantId = keyof typeof INVARIANTS;

/** True when `role` may perform `action`. */
export function can(role: Role, action: CommandType): boolean {
  const who: readonly Role[] = RULEBOOK[action].who;
  return role === 'ADMIN' || who.includes(role);
}
