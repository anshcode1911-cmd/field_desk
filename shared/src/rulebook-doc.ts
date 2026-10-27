import { ROLE_LABELS } from './roles.js';
import {
  INVARIANTS,
  ORDER_LIFECYCLE,
  REACTIONS,
  RULEBOOK,
  SHIPMENT_LIFECYCLE,
  type Lifecycle,
} from './rulebook.js';

const ORDER_STATUSES = 6;
const SHIPMENT_STATUSES = 4;
const ROLES = Object.keys(ROLE_LABELS).length;

function table(head: string[], rows: string[][]) {
  return [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}
const code = (value: string) => `\`${value}\``;
const list = (values: readonly string[]) => values.join(', ') || '—';
const lifecycle = (title: string, l: Lifecycle<string, string>) =>
  `### ${title} (${l.rule})\n\n${table(
    ['Operation', 'From', 'To'],
    l.rows.map(([operation, from, to]) => [
      operation,
      list(from.map(code)),
      code(to),
    ]),
  )}`;

/** Renders the rulebook as Markdown for people who don't read TypeScript. */
export function renderRulebook(): string {
  const actions = Object.entries(RULEBOOK);
  const orderRows = ORDER_LIFECYCLE.rows.length;
  const shipmentRows = SHIPMENT_LIFECYCLE.rows.length;
  const invariants = Object.keys(INVARIANTS).length;
  const reactions = Object.keys(REACTIONS).length;
  const declarations =
    actions.length + orderRows + shipmentRows + invariants + reactions;
  const naive = ROLES * actions.length * ORDER_STATUSES * SHIPMENT_STATUSES;
  return `# FieldDesk rulebook

> Generated from [\`shared/src/rulebook.ts\`](../../shared/src/rulebook.ts) by \`pnpm rules:doc\`. Do not edit by hand: a test fails when this file and the code disagree. Rule ids refer to the [canonical business rules](../candidate-walkthrough/canonical_business_rules.md).

**How to read it.** Each action says who may do it, what happens, and which follow-up policies run afterwards. Admin may perform every action. Status changes follow the lifecycle tables: an operation is allowed only from the listed statuses. After every action, the invariants are checked for every affected customer, and any failure undoes the whole action.

## Actions

${table(
  ['Action', 'Who (besides Admin)', 'What happens', 'Then', 'Rules'],
  actions.map(([type, rule]) => [
    code(type),
    list(rule.who.map((role) => ROLE_LABELS[role])),
    rule.says,
    list(rule.then),
    list(rule.rules),
  ]),
)}

## Follow-up policies

They run in this order and never trigger each other.

${table(
  ['Policy', 'Runs for', 'What it does', 'Rules'],
  Object.entries(REACTIONS).map(([name, reaction]) => [
    name,
    reaction.scope === 'subject'
      ? 'the customer the action is about'
      : 'every affected customer',
    reaction.says,
    list(reaction.rules),
  ]),
)}

## Lifecycles

First matching row wins; no matching row means the operation is refused.

${lifecycle('Orders', ORDER_LIFECYCLE)}

${lifecycle('Shipments', SHIPMENT_LIFECYCLE)}

## Invariants checked before every commit

${table(
  ['Check', 'Guarantees', 'Rules'],
  Object.entries(INVARIANTS).map(([id, invariant]) => [
    code(id),
    invariant.says,
    list(invariant.rules),
  ]),
)}

## Size

${table(
  ['Measure', 'Value'],
  [
    [
      'Declarations in this rulebook',
      `${declarations} (${actions.length} actions, ${orderRows + shipmentRows} lifecycle rows, ${invariants} invariants, ${reactions} policies)`,
    ],
    [
      'Naive scenarios: roles × actions × order statuses × shipment statuses',
      `${ROLES} × ${actions.length} × ${ORDER_STATUSES} × ${SHIPMENT_STATUSES} = ${naive.toLocaleString('en-US')}`,
    ],
  ],
)}

Adding an action adds one row here; adding a status adds lifecycle rows. Scenarios grow multiplicatively, but the rulebook grows additively. Financial state (charges, receipts, credit, points) is quantities, not statuses, so it is guarded by invariants rather than enumerated, and it is not included in the naive count.
`;
}
