# FieldDesk rulebook

> Generated from [`shared/src/rulebook.ts`](../../shared/src/rulebook.ts) by `pnpm rules:doc`. Do not edit by hand: a test fails when this file and the code disagree. Rule ids refer to the [canonical business rules](../candidate-walkthrough/canonical_business_rules.md).

**How to read it.** Each action says who may do it, what happens, and which follow-up policies run afterwards. Admin may perform every action. Status changes follow the lifecycle tables: an operation is allowed only from the listed statuses. After every action, the invariants are checked for every affected customer, and any failure undoes the whole action.

## Actions

| Action | Who (besides Admin) | What happens | Then | Rules |
| --- | --- | --- | --- | --- |
| `UPDATE_CUSTOMER` | Sales, Accounts | Change a customer’s name or unique code. | — | — |
| `PUNCH_ORDER` | Sales | Create a draft order at agreed prices and current catalog points rates. | — | ORD-005, CAT-002 |
| `EDIT_ORDER` | Sales | Replace the commercial terms with a new revision, only before any dispatch or cancellation; approved orders need reapproval and loading batches are voided. | — | ORD-003, ORD-005, ORD-006 |
| `SUBMIT_ORDER` | Sales | Send the current revision for KAM review. | — | ORD-005 |
| `APPROVE_ORDER` | Key Account Manager | Approve exactly the current revision; its reward entitlement becomes locked points. | — | ORD-005, REW-001 |
| `REJECT_ORDER` | Key Account Manager | Reject exactly the current revision, with a reason. | — | ORD-005 |
| `CANCEL_REMAINDER` | Sales | Cancel selected or all unshipped units, with a reason; loading batches are voided. | refresh rewards | ORD-004, ORD-005, ORD-006 |
| `START_LOADING` | Warehouse Manager | Reserve open units of the approved current revision in a loading batch. | — | FUL-003, FUL-004 |
| `DISPATCH_SHIPMENT` | Warehouse Manager | Dispatch a whole loading batch that names the approved current revision. | — | FUL-003, FUL-005 |
| `CONFIRM_DELIVERY` | Warehouse Manager | Confirm some or all dispatched units as delivered; each confirmation creates exactly one goods charge. | allocate free cash, refresh rewards | FUL-006, WF-005 |
| `CORRECT_DELIVERY` | Key Account Manager | Lower an overstated delivered quantity to what actually arrived, with a reason and evidence: the newest confirmations are reversed by linked entries, their charges reduced, excess settlement released back to its sources, and the shipment reopened so Warehouse can confirm the rest later. Freed cash stays unapplied until the next allocation occasion. | refresh rewards | FUL-001, FUL-006, WF-001, WF-003, WF-005 |
| `RECORD_RETURN` | Warehouse Manager | Receive delivered units back with an explicit deduction; reduce their charges, release excess settlement to its sources, charge the deduction and keep remaining released cash as credit. | allocate free cash, refresh rewards | RET-001, RET-002, WF-003 |
| `CORRECT_DISPATCHED_ORDER` | Key Account Manager | Record authorized additional goods that were physically dispatched, with evidence; asks which dispatch they left on. | allocate free cash, refresh rewards | WF-004, WF-005 |
| `RECEIVE_CUSTOMER_PAYMENT` | Accounts | Record money received from a customer. | allocate free cash, refresh rewards | ACC-002, WF-002 |
| `ALLOCATE_PAYMENT` | Accounts | Explicitly apply the customer’s unallocated cash. | allocate free cash, refresh rewards | ACC-003, WF-002 |
| `MOVE_PAYMENT` | Accounts | Move a payment recorded against the wrong customer, with a reason and the bank reference that proves the payer: the wrong customer’s settlements from it are released (their charges reopen and points earned from it are recovered), and the same money is received and applied at the right customer. If the payment funds credit, asks before withdrawing the unused credit; credit already applied or refunded must be reversed first, because credit cannot cross accounts. | allocate free cash, refresh rewards | CUS-001, WF-001, ACC-002, ACC-003, WF-002, CRD-001, REW-003 |
| `REDEEM_POINTS` | Sales, Accounts | Settle a selected charge with available points (one point = one paise), only when no clawback is pending. | — | REW-004 |
| `ISSUE_CREDIT_NOTE` | Accounts | Reserve unallocated cash as an explicit credit note, with a reason. | — | CRD-001, CRD-002, CRD-006 |
| `APPLY_CREDIT_NOTE` | Accounts | Settle a selected charge with open credit. | — | CRD-003 |
| `REFUND_CREDIT_NOTE` | Accounts | Record a payout of open credit against its funding receipts, with a bank reference. | — | CRD-004 |
| `REVERSE_CREDIT_APPLICATION` | Accounts | Undo part or all of a credit application with a linked negative entry. | — | CRD-005, CRD-006 |
| `REVERSE_CREDIT_REFUND` | Accounts | Undo part or all of a recorded refund with a linked negative entry and a bank reference. | — | CRD-005, CRD-006 |

## Follow-up policies

They run in this order and never trigger each other.

| Policy | Runs for | What it does | Rules |
| --- | --- | --- | --- |
| allocate free cash | the customer the action is about | Apply unallocated customer cash to outstanding charges, oldest first. | ACC-003, WF-002 |
| refresh rewards | every affected customer | Recompute locked, earned and clawback points from approved quantities and cash, and post only the difference. | REW-001, REW-002, REW-003 |

## Lifecycles

First matching row wins; no matching row means the operation is refused.

### Orders (ORD-005)

| Operation | From | To |
| --- | --- | --- |
| edit | `APPROVED`, `REAPPROVAL_REQUIRED` | `REAPPROVAL_REQUIRED` |
| edit | `DRAFT`, `PENDING`, `REJECTED` | `DRAFT` |
| submit | `DRAFT`, `REJECTED` | `PENDING` |
| submit | `REAPPROVAL_REQUIRED` | `REAPPROVAL_REQUIRED` |
| approve | `PENDING`, `REAPPROVAL_REQUIRED` | `APPROVED` |
| reject | `PENDING`, `REAPPROVAL_REQUIRED` | `REJECTED` |
| cancel every unit, none dispatched | `DRAFT`, `PENDING`, `APPROVED`, `REJECTED`, `REAPPROVAL_REQUIRED` | `CANCELLED` |
| record additional dispatched goods | `APPROVED` | `APPROVED` |

### Shipments (FUL-004..006)

| Operation | From | To |
| --- | --- | --- |
| dispatch | `LOADING` | `DISPATCHED` |
| confirm some dispatched units | `DISPATCHED` | `DISPATCHED` |
| confirm the last undelivered units | `DISPATCHED` | `DELIVERED` |
| void after an order change | `LOADING` | `VOIDED` |
| correct an overstated delivery | `DISPATCHED`, `DELIVERED` | `DISPATCHED` |

## Invariants checked before every commit

| Check | Guarantees | Rules |
| --- | --- | --- |
| `approval` | An approved order carries an approval of its current revision. | ORD-005 |
| `quantities` | Per order line: ordered = canceled + dispatched + open; returned ≤ delivered ≤ dispatched; loading ≤ open. | ORD-001, FUL-001 |
| `reward-accrual` | Per approved line, earned and locked points match qualifying cash and retained units. | REW-001, REW-002 |
| `shipment` | Every live shipment uses an approved revision; loading batches use the current one. | FUL-003 |
| `shipment-quantities` | Per shipment line: returned ≤ delivered ≤ dispatched ≤ loaded. | FUL-001 |
| `delivery-charge` | Each delivery confirmation, and each correction of one, has exactly one charge entry worth quantity × shipment price. | WF-005 |
| `recognized-value` | Posted charges = delivered goods − returned goods + return deductions. | WF-005, RET-002 |
| `settlement` | Each charge’s cash, credit, points and outstanding amount are non-negative. | ACC-001 |
| `cash` | Each receipt’s money is allocated or reserved at most once. | ACC-002 |
| `credit` | Each credit note is fully receipt-funded and within its application and refund limits. | CRD-001 |
| `reward-conservation` | Locked + available + redeemed − clawback pending = retained entitlement; points are never available while clawback is pending. | REW-003 |
| `redemption-evidence` | Redeemed points equal the recorded point settlements. | REW-004 |
| `account-position` | Net balance = outstanding charges − unapplied cash − open credit. | ACC-001, ACC-002, CRD-001 |
| `activity-uniqueness` | Each applied activity has exactly one audit event per affected customer. | WF-001 |

## Size

| Measure | Value |
| --- | --- |
| Declarations in this rulebook | 51 (22 actions, 13 lifecycle rows, 14 invariants, 2 policies) |
| Naive scenarios: roles × actions × order statuses × shipment statuses | 5 × 22 × 6 × 4 = 2,640 |

Adding an action adds one row here; adding a status adds lifecycle rows. Scenarios grow multiplicatively, but the rulebook grows additively. Financial state (charges, receipts, credit, points) is quantities, not statuses, so it is guarded by invariants rather than enumerated, and it is not included in the naive count. Algorithms (ACC-003 cash allocation order, the WF-003 release, reward derivation, credit limits) are code rather than declarations. Each lives in one place (`SettlementService`, `AccountsService.allocateCash`, `RewardsService.refresh`), and this page shows which actions trigger them.
