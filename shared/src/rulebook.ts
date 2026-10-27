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
  'allocate free cash':
    'ACC-003: apply unallocated customer cash to outstanding charges, oldest first.',
  'refresh rewards':
    'REW-001..003: recompute locked, earned and clawback points from approved quantities and cash, and post only the difference.',
} as const;
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

/** True when `role` may perform `action`. */
export function can(role: Role, action: CommandType): boolean {
  const who: readonly Role[] = RULEBOOK[action].who;
  return role === 'ADMIN' || who.includes(role);
}
