# Architecture v3: after research and LLM discussion

> **Provenance (corrected after review):** Written by Claude on 28 Oct 2026, shortly after v2. Claude searched for and read the primary sources linked below and weighed the trade-offs itself. There was no back-and-forth with Ansh at this stage, so the "discussion with an LLM" in the title is the agent's own analysis. This draft records what was borrowed, what was rejected, and why. Sections of v2 that didn't change are not repeated.

## 1. Options compared

| Option                                                                                       | Strength                                                                                               | Weakness for FieldDesk                                                                                                                                                                                                       | Decision                                                                    |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Drools / DRL** `when … then … end`, forward chaining over working memory [1]               | Mature; `when/then` reads naturally                                                                    | JVM, outside a TypeScript stack. Chained rules modify facts that trigger other rules, which Fowler calls "very hard to reason about and debug" [2]                                                                           | Rejected. Keep only the `when/then` **vocabulary**                          |
| **json-rules-engine**: `all/any` conditions over facts, emits events [3]                     | Rules as data; async facts                                                                             | Only **reports** which rules fired; mutations stay in our code anyway. Our conditions are ledger sums (`Σ cash`, `Σ delivered`), so the "facts" would be the same repository code plus a dependency, with types lost in JSON | Rejected                                                                    |
| **XState statecharts**: typed states, guards, actions [4]                                    | Excellent for long-lived actor lifecycles                                                              | Order and shipment statuses are tiny, and fulfillment status is **derived from quantities**, not stored. Persisting a machine snapshot per row adds a second source of truth                                                 | Rejected; a transition **table** is enough                                  |
| **DMN decision tables** with hit policies (Unique / First / Collect) [5]                     | Business-readable rows; "First" mirrors "check the clearest cases first"                               | Full DMN tooling (FEEL, modelers) is heavy                                                                                                                                                                                   | **Borrowed:** lifecycle transitions as first-hit tables in plain TypeScript |
| **Event sourcing + saga**: modules emit events, compensating events undo committed steps [6] | Fits distributed systems where one transaction can't span services                                     | We have **one SQLite transaction** per action. Atomic rollback is strictly better than compensation here. The ledger is already append-only (WF-001)                                                                         | Rejected for now; listed in the decision tree for when it **would** fit     |
| **Hand-rolled, domain-specific catalog** (v2)                                                | Fowler recommends "a more domain specific approach" over a product [2]; typed; reviewers read one file | We maintain it ourselves                                                                                                                                                                                                     | **Chosen**                                                                  |

## 2. What changed from v2

1. **No chaining, on purpose.** Each action's reactions are an explicit, ordered list in the catalog (`then: [...]`). No rule can trigger another rule implicitly. This confirms the switch away from the v1 fixpoint loop and directly answers Fowler's main objection.
2. **Lifecycles become decision tables.** ORD-005 and the shipment lifecycle move out of `OrderModel.assert*` and the scattered `status:` writes into one table per entity. The table has rows `(from, operation) → to`, is evaluated first-hit, and cites a rule id on each row. A missing row means the transition is illegal, and the error names the rule. This is the "state machine that prevents undefined states" from the hint, without a library.

   ```ts
   export const ORDER_LIFECYCLE = table('ORD-005', [
     //  operation   from                               to
     ['submit', ['DRAFT', 'REJECTED'], 'PENDING'],
     ['submit', ['REAPPROVAL_REQUIRED'], 'REAPPROVAL_REQUIRED'],
     ['approve', ['PENDING', 'REAPPROVAL_REQUIRED'], 'APPROVED'],
     ['reject', ['PENDING', 'REAPPROVAL_REQUIRED'], 'REJECTED'],
     ['edit', ['APPROVED', 'REAPPROVAL_REQUIRED'], 'REAPPROVAL_REQUIRED'],
     ['edit', ['DRAFT', 'PENDING', 'REJECTED'], 'DRAFT'],
   ]);
   ```

3. **Questions only where the rules can't decide.** Research into "reconciliation engines" pushed toward asking more questions. We chose the opposite default: if a canonical rule determines the outcome, we apply it and explain it in the trace. FDSK-169's reopened charges are a good example, because WF-002 says not to auto-allocate. We ask only when the facts genuinely can't decide, as in WF-004's "which dispatch?". Fewer questions mean fewer UI branches, which is the same combinatorial argument applied to the UI.
4. **The scenario count is computed, not hand-waved.** The catalog knows each action's roles and each lifecycle table knows its legal rows. `pnpm rules:doc` also prints how many (actor, action, legal from-state) combinations the catalog permits, next to the naive product, so the "explosion" is measured for this repo.

## 3. Final shape of the solution (Solution A)

```
server/src/rules/
  catalog.ts      every action: rule ids, who, says, then, run
  lifecycle.ts    ORDER and SHIPMENT transition tables (first-hit)
  policies.ts     chargeSettlement, receiptCapacity, releaseOverSettlement
  engine.ts       catalog lookup → role check → handler → ordered reactions
  invariants.ts   named invariants with canonical ids (from AuditService.review)
scripts/rules-doc  generates docs/solution/RULES.md (+ staleness test)
```

The dispatcher keeps idempotency, versioning, and the transaction. Services keep their domain writes and lose their role checks, reaction tails, and duplicated arithmetic.

## 4. Second solution (bonus): deferred

The alternative would trade more framework code for less workflow code. It would declare guards as data, evaluated by a generic engine (json-rules-engine style), so new guards ship without code changes. We decided to finish Solution A and both user stories first, then decide whether there's time. Either way, the trade-off is analysed in the decision-tree document.

## References

1. Drools rule language reference: <https://kie.apache.org/docs/10.0.x/drools/drools/language-reference-traditional/index.html>
2. Martin Fowler, _Rules Engine_ (2009): <https://martinfowler.com/bliki/RulesEngine.html>
3. json-rules-engine: <https://npmjs.com/package/json-rules-engine>
4. XState v5 machines: <https://stately.ai/docs/machines>
5. Camunda, _Choosing the DMN hit policy_: <https://docs.camunda.io/docs/components/best-practices/modeling/choosing-the-dmn-hit-policy/>
6. Saga pattern overview: <https://www.conduktor.io/glossary/saga-pattern-for-distributed-transactions>
