# Architecture v4: final (as built)

> **Provenance:** Written by Claude on 28 Oct 2026 after implementation and an independent red-team review, for Ansh to review before submission. Every claim below describes code on `main` and was verified by tests or by running the app. Differences from v3 are listed first.

## 1. What changed from v3

| v3 said                                                 | What happened                                                                                                                                                                                                                       |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalog lives in `server/src/rules/catalog.ts`          | It moved to `shared/src/rulebook.ts`, because the client repeated the same role lists. Server and client now both call `can(role, action)` and `nextStatus(...)`.                                                                   |
| Reactions run for "the customer"                        | FDSK-169 touches two customers. Each policy now declares its scope: `allocate free cash` is an allocation occasion for the action's subject (WF-002); `refresh rewards` is a derivation and runs for every affected customer.       |
| Scenario count computed per (role, action, from-status) | **Dropped.** Doing it properly needed a second action→lifecycle mapping that would duplicate the `transition()` calls. RULES.md instead reports declarations (51) against the naive count (2,640), with a note on what is excluded. |
| Invariants move into `rules/invariants.ts`              | The checks stayed in `AuditService.review`, where their queries live. Each now takes a typed id from `INVARIANTS` (rule ids plus a plain sentence), so an unregistered check can't compile.                                         |
| Second solution deferred                                | Built as `solution-b/plain-services` and compared in [two-solutions.md](../two-solutions.md).                                                                                                                                       |

## 2. Components and data flow

```mermaid
flowchart TD
  UI[React client<br/>buttons via can() and nextStatus()] -->|POST /api/crm/actions| C[ActionsController<br/>Zod schema]
  C --> D[ActionsService dispatcher<br/>immediate SQLite transaction,<br/>idempotency key, expected version]
  RB[(shared/src/rulebook.ts<br/>RULEBOOK · REACTIONS ·<br/>ORDER/SHIPMENT_LIFECYCLE · INVARIANTS)]
  D -->|who| RB
  D --> H[handlers.ts → domain service method]
  H -->|transition()| RB
  H --> S[SettlementService<br/>charge · receipt · releaseOverSettlement]
  H --> R[(Repositories → SQLite)]
  D -->|then, by scope| P1[allocate free cash<br/>AccountsService.allocateCash]
  D -->|then, by scope| P2[refresh rewards<br/>RewardsService.refresh]
  D --> V[for every affected customer:<br/>version bump · audit event · AuditService.review]
  V -->|check ids typed by| RB
  V -- any check fails --> X[rollback, REJECTED<br/>ACCOUNT_INCONSISTENT with rule ids]
  V -- all pass --> OK[commit, APPLIED + trace + review]
  RB -->|pnpm rules:doc| DOC[docs/solution/RULES.md<br/>test-guarded]
```

**One action, step by step:**

1. The dispatcher checks idempotency and version.
2. It checks `RULEBOOK[type].who`.
3. The handler records the facts (`transition()` guards any status change, and shared policies do the settlement work).
4. The declared `then` policies run in fixed order, for their scope.
5. For each affected customer, the dispatcher bumps the version, writes an audit event, and runs the 14 named invariants.
6. Everything commits, or everything rolls back.

## 3. Building blocks

| Block                                                    | Pattern                                                        | Where                                      | Why                                                                                  |
| -------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------ |
| `RULEBOOK` (who / says / then / rule ids per action)     | Declarative specification table                                | `shared/src/rulebook.ts`                   | One place for permissions and follow-ups, shared by server, client and docs          |
| `REACTIONS` with a fixed order and a scope               | Explicit policy pipeline (no chaining)                         | same                                       | Cash before points; no rule triggers another implicitly                              |
| `ORDER_LIFECYCLE`, `SHIPMENT_LIFECYCLE` + `transition()` | First-hit decision table (borrowed from DMN)                   | same + `server/src/common/domain.ts`       | Status rules read as rows; a refusal names the rule                                  |
| `INVARIANTS` + `AuditService.review`                     | Design by contract: post-conditions checked in the transaction | same + `server/src/audit/audit.service.ts` | Any action that would break the books is undone, and the error says which rule broke |
| `SettlementService`                                      | Policy object, single source of the arithmetic                 | `server/src/settlement/`                   | ACC-001/002 math and the WF-003 release in one place                                 |
| Linked reversals + derive-and-diff rewards               | Append-only ledger, compensating entries                       | deliveries, allocations, receipt transfers | Corrections never edit history (WF-001); balances follow from facts                  |
| `handlers.ts`                                            | Command map                                                    | `server/src/actions/`                      | Replaces the 21-case `switch`; TypeScript forces one handler per action              |

## 4. Schema changes

| Migration                    | Change                                                                                                                                                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0006_reversible_deliveries` | `deliveries.reversal_of_id` (self FK), `reason`, `evidence`. Check: `qty > 0` with no reversal, or `qty < 0` reversing a named confirmation. The generated INSERT was fixed to copy only existing columns, as in the repository's own `0003` migration. |
| `0007_receipt_transfers`     | New `receipt_transfers(receipt_id, from_customer_id, to_customer_id, new_receipt_id, amount_paise, reason, reference, …)` with `amount > 0` and `from ≠ to` checks.                                                                                     |

A new receivable kind, `DELIVERY_CORRECTION`, holds the linked negative adjustment for each reversed confirmation. Existing sums (delivered quantity, recognized value, adjustments per charge) absorb the negative rows with no other change.

## 5. API

Both stories use the existing action endpoint and envelope. See [api.md](../../api.md).

| Action             | Payload                                                                          | Who             |
| ------------------ | -------------------------------------------------------------------------------- | --------------- |
| `CORRECT_DELIVERY` | `orderId, shipmentId, items[{ shipmentLineId, deliveredQty }], reason, evidence` | KAM, Admin      |
| `MOVE_PAYMENT`     | `customerId, receiptId, toCustomerId, reason, reference`                         | Accounts, Admin |

Response changes: each review check now carries `rules`. `aggregateVersions` and the audit trail include both customers for `MOVE_PAYMENT`.

## 6. The two stories: assumptions and behavior

**FDSK-170: correct an overstated delivery**

- `deliveredQty` is the corrected **total** for the line, since the story says "correct the entry to six". It must be below the confirmed quantity and at least the returned quantity (FUL-001).
- The missing units are treated as **still in transit**, so a `DELIVERED` shipment returns to `DISPATCHED` and Warehouse confirms them later with the normal action. Lost goods would need a different correction that the canonical rules don't define.
- The newest confirmations are reversed first, and each reversal adjusts **its own** charge. Returns consume charges oldest first, so every reversed charge still has value whenever corrected ≥ returned.
- Settlement above a reduced charge is released (cash, then credit, then points) back to its sources, using the same code as returns.
- Freed cash is **not** auto-applied: corrections aren't a WF-002 occasion. It is picked up when Warehouse confirms the remaining units (a delivery is an occasion), which is exactly the story's ending.
- Points are re-derived. Points already spent become clawback pending (REW-003).

**FDSK-169: move a payment recorded against the wrong customer**

- The whole receipt moves. A receipt that mixed two customers' money is out of scope.
- The original receipt stays on record with zero retained value. A new receipt with the same bank reference is created at the payer, and a `receipt_transfers` row links the two with the reason and the reference that proved the mistake.
- The wrong customer's allocations from that receipt are released, so their charges reopen and points earned from that cash are recovered (clawback pending if spent). Their **other** free cash is not auto-applied (WF-002). Accounts can run `ALLOCATE_PAYMENT`.
- The payer becomes the action's subject, so allocation runs there (receiving a payment is a WF-002 occasion).
- **Refused** if the receipt funds a credit note (`RECEIPT_FUNDS_CREDIT`). Credit can't cross accounts (CUS-001), and the canonical rules define no way to withdraw funding, so guessing would be worse than refusing.
- The expected version is the wrong customer's, because that's the record Accounts is looking at. Both customers' versions advance.

## 7. Failure handling

| Failure                                                          | Behavior                                                                                                                                                                                                     | Verified by                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Wrong role                                                       | `FORBIDDEN`, decided by the rulebook, before any write                                                                                                                                                       | Story tests (3 roles each)                                 |
| Wrong status (e.g. correcting a loading batch)                   | `SHIPMENT_STATE` / `ORDER_STATE`, message names the lifecycle rule                                                                                                                                           | Story test                                                 |
| Correction below returns / not lower                             | `RETURNED_EXCEEDS_CORRECTION` / `CORRECTION_NOT_LOWER`                                                                                                                                                       | Story test                                                 |
| Moving a moved, foreign, same-customer or credit-funding receipt | Specific codes; ledger unchanged                                                                                                                                                                             | Story test (`assert.deepEqual` on the ledger)              |
| A bug that would break balances                                  | Invariants fail and the whole action rolls back with rule ids                                                                                                                                                | 3 mutation checks (see Evaluator notes)                    |
| Concurrent or stale requests, retries                            | Existing immediate transaction, expected versions, idempotency keys (unchanged)                                                                                                                              | Existing suites                                            |
| One customer's checks fail in a two-customer action              | Single transaction, so neither customer changes                                                                                                                                                              | Dispatcher reviews every affected customer                 |
| Existing databases                                               | Migrations apply on existing data. A seeded upstream DB (10 customers, 24 deliveries) was upgraded to `0007`: all 24 deliveries were kept with default reason and evidence, and 258/258 review checks passed | `migrations.test.ts`; manual upgrade run (Evaluator notes) |

## 8. Known limitations

- Partial receipt moves, and moving receipts that fund credit, are refused rather than supported.
- A delivery correction only lowers quantities. Raising a confirmed delivery means confirming more units (an existing action).
- Reward refresh and invariant review recompute per customer. That's fine at CRM scale but would need incremental projections for very large accounts.
- The rulebook is data in TypeScript. Changing it needs a deploy, which is deliberate (see the [decision tree](../when-to-build-a-rules-framework.md)).
- Older UI dialogs still use per-type flags in `activity-dialog.tsx`, a UI-side version of the same combinatorial problem. They weren't refactored, to protect scope.
