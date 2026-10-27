# Two solutions with different trade-offs

This is bonus deliverable 2. Both solutions implement FDSK-169 and FDSK-170 on the same schema and pass **the same test file** (`server/test/corrections.test.ts`, 8 tests) plus the 251 original tests. They differ only in where the business rules live.

- **Solution A** (`main`): the rulebook. Permissions, follow-up policies, lifecycles and invariants are declared once and enforced by a small engine. Settlement arithmetic and the WF-003 release live in one shared module.
- **Solution B** (`solution-b/plain-services`): no framework. The two stories are written in the repository's original style, with role checks, status checks and follow-up calls inside each service method. That branch's `docs/solution-b.md` explains it.

## Measured comparison

Lines are from `git diff --numstat` over `server/src` and `shared/src`, excluding Markdown.

| Measure                                               | A: rulebook                                                                   | B: plain services                                 |
| ----------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------- |
| Framework mechanism                                   | ~686 lines (rulebook data 331, doc renderer 116, handlers 75, settlement 164) | 0                                                 |
| Refactor before the stories                           | 23 files, +742 / −341                                                         | none                                              |
| The stories (schema to finished feature)              | 16 files, +483 / −74                                                          | 13 files, +509 / −35                              |
| Role checks inside services                           | 0 (one `who` per action)                                                      | 22 `authorize(...)` calls                         |
| Copies of the WF-003 release (cash → credit → points) | 1, shared by returns and delivery corrections                                 | 2                                                 |
| Places that compute "receipt money still free"        | 1 (`SettlementService.receipt`)                                               | 5 (each patched for moved receipts)               |
| Follow-up calls written by hand                       | 0 (declared as `then` and run by the dispatcher)                              | 15                                                |
| Two-customer follow-ups                               | Declared scope per policy (subject vs every affected customer)                | Swap `c.customerId` between calls                 |
| Rules a non-technical reader can review               | Generated [RULES.md](RULES.md), test-guarded                                  | Canonical docs only; the code may drift from them |
| Tests                                                 | 260 (adds the RULES.md sync test)                                             | 259                                               |

## What the numbers say

**For these two stories alone, A did not save lines.** Both solutions needed about 500 lines for the stories, and A also paid ~400 net lines up front. A's return is elsewhere:

1. **Changing a rule touches one place.** In B, moving a receipt meant patching five free-cash formulas. Missing one would have produced wrong balances that only the audit check would catch. In A, it was one line in `SettlementService.receipt`.
2. **The next correction is cheaper.** A third correction story (for example, an overstated return) in A is a rulebook entry plus a service method that calls `releaseOverSettlement`. In B it is a third copy of the release block, another `authorize`, and more hand-written follow-ups.
3. **The rules are reviewable.** A's RULES.md lists who may do what, the lifecycle tables, and the invariants. It is generated from the same objects the server enforces.

**B is the right choice** when there are few actions, rules rarely change, and one team owns all the code. In that case it adds zero framework and reads like the rest of the codebase. The [decision tree](when-to-build-a-rules-framework.md) turns this into signals you can measure (duplication count, files touched per rule change, cost of a wrong rule). FieldDesk had rule duplication in three or more places before either story, which is why A is on `main`.

## How to check out B

```sh
git checkout solution-b/plain-services
pnpm install && pnpm test        # 259/259
```
