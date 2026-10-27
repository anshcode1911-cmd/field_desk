# Architecture v2: refined after reading the code

> **Provenance:** Ansh + Claude, 28 Oct 2026. This revision comes from reading every domain service, model, the audit review, the dispatcher, and the test harness. It records where v1 was wrong.

## 1. What the code read changed

v1 assumed the usual "if/else spaghetti". The code is actually layered cleanly: models, typed repositories, services, a single action endpoint with idempotency and versioning, and an append-only ledger. The problem is different, and the solution needs to change with it.

**The rules are scattered and copied, not tangled.**

| Symptom (measured in `server/src`)                                                                    | Canonical rule it hides | Consequence                                                    |
| ----------------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------- |
| 20 `authorize(c, ...)` calls repeat the roles table                                                   | Roles table             | A permission change means editing services, not one table      |
| `allocateCash` + `rewards.refresh` tails copied into 6 handlers; `approve`/`edit` post rewards inline | WF-002, REW-001..003    | The "who triggers allocation" rule can't be read anywhere      |
| Charge outstanding `v − c − k − z` computed in 6 places; receipt free cash in 4                       | ACC-001, ACC-002        | A new correction (FDSK-169) must touch every copy              |
| Settlement release (cash → credit → points) exists only inline in `ReturnsService`                    | WF-003                  | FDSK-170 needs the same release and would duplicate it         |
| ~14 invariant checks in `AuditService.review` with free-text labels                                   | ORD/FUL/ACC/CRD/REW     | They already roll back bad actions, but don't name their rules |
| Dispatcher `switch` with 21 cases and a single `customerId` per action                                | n/a                     | FDSK-169 touches **two** customers                             |
| `DomainDecision` (questions) used once, for WF-004                                                    | 7.2 ambiguity           | The mechanism exists but isn't general                         |

**What v1 got right and is already in the code.** Reward points are derived and only the difference is posted (`RewardsService.refresh`). Invariants are checked after every action, inside the transaction. History is append-only, with linked negative entries.

**What v1 got wrong.**

1. A "run reactions until nothing changes" loop is overkill. The dependency chain is a fixed, short DAG: _physical facts → charges → settlement release → cash allocation → rewards → invariants_. A fixed, declared order is simpler and easier to explain.
2. Turning every handler into a pure `decide()` that returns facts would rewrite ~2,000 lines of working, tested code for little gain. Handlers keep writing inside the transaction. The framework owns everything **around** them.

## 2. Design: rule catalog + policy pipeline

```mermaid
flowchart TD
  A[POST /crm/actions] --> B[Dispatcher: idempotency, version, transaction]
  B --> C[Catalog lookup: ACTIONS[type]]
  C --> D{who: role allowed?}
  D -- no --> R1[REJECTED FORBIDDEN]
  D -- yes --> E[handler: guards + domain facts]
  E -- DomainDecision --> Q[NEEDS_DECISION + questions]
  E --> F[then: declared reactions in fixed order]
  F --> F1[release over-settlement WF-003]
  F --> F2[allocate free cash ACC-003 / WF-002]
  F --> F3[refresh rewards REW-001..003]
  F1 & F2 & F3 --> G[invariants for every touched customer]
  G -- violation --> R2[rollback, REJECTED with rule id]
  G -- ok --> H[version bump + audit for every touched customer]
```

### 2.1 `rules/catalog.ts`: the one file a reviewer reads

```ts
CONFIRM_DELIVERY: {
  rules: ['FUL-006', 'WF-005'],
  who: ['WAREHOUSE'],
  says: 'Confirm some or all dispatched units; each confirmation creates one goods charge.',
  then: ['allocate free cash', 'refresh rewards'],
  run: (s, c, p) => s.fulfillment.deliver(c, p),
},
```

- `who` replaces the 20 `authorize` calls. Admin is implicit, per the business terms.
- `then` replaces the copied tails. WF-002's list of allocation occasions becomes a column you can read.
- `says` and `rules` are plain English plus canonical ids. `pnpm rules:doc` generates `docs/solution/RULES.md` from the same object, and a test fails if the doc is stale. That makes the documentation the executable rules, not a copy of them.

### 2.2 Shared policies (one implementation per rule)

| Policy                          | Rule         | Used by                                                 |
| ------------------------------- | ------------ | ------------------------------------------------------- |
| `chargeSettlement(charge)`      | ACC-001      | allocation, redemption, credit apply, summary, release  |
| `receiptCapacity(receipt)`      | ACC-002      | allocation, credit issue, summary, invariants, FDSK-169 |
| `allocateFreeCash(customer)`    | ACC-003      | `then: allocate free cash`                              |
| `releaseOverSettlement(charge)` | WF-003       | `RECORD_RETURN`, **FDSK-170**                           |
| `refreshRewards(customer)`      | REW-001..003 | `then: refresh rewards`                                 |

### 2.3 Invariants registry

Move the `AuditService.review` checks into `rules/invariants.ts` as `{ id: 'FUL-001', says, check }`. Keep the `AccountReview` output shape so the UI and tests don't change. A failed action reports the canonical id of the broken invariant.

### 2.4 Multi-customer actions

Each action context gets `touched: Set<customerId>`. Invariants, version bumps, and audit events run for every touched customer. Today all actions touch exactly one; FDSK-169 touches two.

## 3. The two features

### FDSK-170: `CORRECT_DELIVERY` (KAM, Admin)

**Payload:** `orderId, shipmentId, items[{ shipmentLineId, deliveredQty }], reason, evidence`. `deliveredQty` is the corrected **total** delivered on that line, matching the story's "correct the entry to six".

| Step | Mechanism                                                                                                                                                                                              | Rule        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| 1    | Guards: corrected < current delivered, and corrected ≥ returned                                                                                                                                        | FUL-001     |
| 2    | Reverse the most recent confirmations first. Each reversal is a linked negative `deliveries` row (`reversal_of_id`), following the pattern already used for credit refunds                             | WF-001      |
| 3    | Each reversed confirmation adjusts **its own** charge with a linked negative entry, so "one charge per confirmation" still holds                                                                       | WF-005      |
| 4    | Release settlement above the new charge value: cash, then credit, then points, back to the original sources. Shared with returns                                                                       | WF-003      |
| 5    | Shipment goes from `DELIVERED` back to `DISPATCHED` if units are now undelivered; Warehouse confirms them later                                                                                        | FUL-006     |
| 6    | `then: refresh rewards`: points earned from released cash are relocked. If they were already spent, the shortfall becomes clawback pending                                                             | REW-002/003 |
| 7    | **No** cash allocation, because WF-002 doesn't list corrections. Freed cash stays unapplied and is picked up automatically when Warehouse confirms the remaining units (a delivery **is** an occasion) | WF-002      |

Why reverse latest first? Returns consume charges oldest first (WF-003). Reversing from the newest end means that whenever `corrected ≥ returned`, every touched charge still has enough value. So no "partially returned and partially reversed" charge can go negative.

### FDSK-169: `MOVE_PAYMENT` (Accounts, Admin)

**Payload:** `customerId` (wrong), `receiptId`, `toCustomerId`, `reason`, `reference` (the bank reference that proves the mistake).

| Step | Mechanism                                                                                                                                                                                                  | Rule             |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1    | Guards: receipt belongs to `customerId`; target exists and differs; receipt not already moved                                                                                                              | CUS-001          |
| 2    | **Block** if the receipt funds any credit note. Credit funding can't cross accounts, and the canonical rules have no "withdraw funding" operation. The error lists the notes and the reversals to do first | CUS-001, CRD-001 |
| 3    | Release every allocation of the receipt (linked negative allocations), which reopens the wrong customer's charges                                                                                          | WF-001           |
| 4    | Record a `receipt_transfers` row and a **new receipt** at the right customer with the same bank reference. The original's retained amount `m_i` drops to 0. Nothing is edited in place                     | WF-001, ACC-002  |
| 5    | Rewards refresh for the wrong customer (clawback if spent), cash allocation for the right customer (a receipt is a WF-002 occasion), then rewards refresh for the right customer                           | REW, ACC-003     |
| 6    | Invariants and audit for **both** customers                                                                                                                                                                | §2.4             |

We deliberately do **not** auto-allocate the wrong customer's other free cash to the reopened charges, because WF-002 excludes it. Accounts can run `ALLOCATE_PAYMENT` explicitly.

## 4. Schema changes (one migration per feature)

- `deliveries`: add `reversal_of_id` (self-reference) and `reason`. The check constraint becomes `(qty > 0 and reversal_of_id is null) or (qty < 0 and reversal_of_id is not null)`.
- New table `receipt_transfers(id, receipt_id, from_customer_id, to_customer_id, new_receipt_id, amount_paise, reason, reference, action_id, created_at)`.

Existing sums (`delivered`, recognized value) absorb the negative rows with no change. Receipt capacity becomes `amount − moved out` in exactly one place, which is why §2.2 comes first.

## 5. Plan, in commit-sized steps

1. Catalog plus generic dispatcher (who + then). Behavior unchanged, 251 tests green.
2. Shared policies: settlement, receipt capacity, release. Behavior unchanged.
3. Invariants registry with canonical ids.
4. Multi-customer touch set.
5. FDSK-170: migration → policy → action → tests → UI.
6. FDSK-169: migration → action → tests → UI.
7. Generated rules doc, plus a staleness test.

## 6. Risks and how we'll catch them

| Risk                                                       | Mitigation                                                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Refactor silently changes money or points behavior         | 251 existing tests, including 200 randomized mixed sequences checked independently, run after **every** step |
| Delivery reversal breaks "exactly one charge per delivery" | Extend that invariant to reversals: one linked adjustment per reversal                                       |
| Moved receipt double-counted in balances                   | Single `receiptCapacity` policy; the account-position invariant cross-checks it                              |
| Time (deadline 31 Oct)                                     | Steps 1–6 are P0. The rules doc and UI polish are P1. A second solution (bonus) only if ahead                |

## 7. Still open for the research pass

- Should the catalog be TypeScript objects, or an external DSL / `json-rules-engine` / Drools-style rules? How readable vs. how type-safe?
- Should XState-style statecharts own the order and shipment lifecycles (ORD-005, FUL-004..006)?
- Is a saga or event-driven reaction model worth it here, or does the fixed pipeline cover everything?
