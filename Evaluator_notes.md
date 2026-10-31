# Evaluator notes

**Candidate:** Ansh (BITS Pilani)
**Assignment:** Tejas: Business Rules Engine (AI Engineering take-home)
**Built with:** Claude (Anthropic) as the coding agent, in one Cowork session. Every agent-authored commit carries a `Co-Authored-By: Claude` trailer.

## Start here (5 minutes)

1. [docs/solution/RULES.md](docs/solution/RULES.md): the business rules as one readable page, generated from the code the server enforces.
2. [docs/solution/architecture/](docs/solution/architecture/): v1 → v2 → v3 → final, each committed when it was written.
3. [docs/solution/two-solutions.md](docs/solution/two-solutions.md): the rulebook (`main`) against plain services (`solution-b/plain-services`), with measured numbers.
4. [docs/solution/when-to-build-a-rules-framework.md](docs/solution/when-to-build-a-rules-framework.md): deliverable 3.
5. `server/test/corrections.test.ts`: FDSK-169 and FDSK-170 as executable stories.

## What was built

| Area            | Result                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rules framework | A shared rulebook: who may act, what happens, follow-up policies and rule ids per action, plus first-hit lifecycle tables. Server and client both read it. One settlement module now holds the charge, receipt and credit arithmetic and the WF-003 release. The pre-commit consistency review **already existed** upstream; this work named each check after its canonical rule and extended the review to every customer an action affects. |
| FDSK-170        | `CORRECT_DELIVERY` (KAM). Linked reversals of the newest confirmations, charge adjustments, and release of excess settlement. The shipment reopens and points are re-derived.                                                                                                                                                                                                                                                                 |
| FDSK-169        | `MOVE_PAYMENT` (Accounts). Settlements are released at the wrong customer. A linked transfer and new receipt go to the payer, and cash is allocated there. Points are recovered, and both customers are audited and checked. If the payment funds credit, the system **asks** before withdrawing the unused part (`NEEDS_DECISION`); credit that was already used must be reversed first.                                                     |
| UI              | "Correct delivered quantity" on shipments and "Wrong customer?" on payments, both tried in a browser ([screenshots](docs/solution/screenshots/)).                                                                                                                                                                                                                                                                                             |
| Bonus           | Solution B on branch `solution-b/plain-services`, passing the story tests of the original scope.                                                                                                                                                                                                                                                                                                                                              |

The assumptions behind both stories are listed in [the final architecture, §6](docs/solution/architecture/04-final.md#6-the-two-stories-assumptions-and-behavior).

## Verification (all actually run)

| Check                                                             | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test` on `main`                                             | **262 / 262**: 251 original, 10 story tests, and 1 RULES.md sync test. The 251 original tests were run after every refactor commit. The two commits that were staged from one working tree (`111b70b`, `ef336cc`) were also checked out and tested on their own afterwards: 251/251 and 256/256.                                                                                                                                                         |
| `pnpm test` on `solution-b/plain-services`                        | **259 / 259**                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `pnpm lint`, `pnpm typecheck`, `prettier --check .`, client build | Clean                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Mutation checks (broke the code on purpose, then restored it)     | Each one was caught: <br>• delivery-correction release disabled → 3 tests failed, naming "ACC-001" <br>• payment-move allocation release dropped → failed, naming "ACC-002" <br>• second affected customer dropped → 2 tests failed <br>• credit-funding withdrawal skipped → 2 tests failed, naming "ACC-002"                                                                                                                                           |
| Upgrade of an existing database                                   | Seeded the original repo (migrations 0000–0005, 10 customers, 24 deliveries), then applied 0006–0007 from `main`. All 24 deliveries were kept, and 258/258 review checks passed. Migration 0008 was then applied to the seeded development database, which already had credit funding; after all the browser runs, 261/261 checks passed across 10 customers. `migrations.test.ts` does **not** cover the new migrations; these checks were run by hand. |
| Browser (Playwright, seeded data)                                 | Both flows run. Balance checks stayed 27/27 after a payment move. Moving a credit-funding payment asked the question and completed after confirmation. Role-gated buttons were checked for the Admin, Sales, Warehouse and Accounts desks.                                                                                                                                                                                                               |
| Independent red-team review                                       | A separate agent reviewed the repo as a strict evaluator, without our conclusions. See the next section.                                                                                                                                                                                                                                                                                                                                                 |

**Not verified:** behavior under real concurrent load beyond the existing concurrency tests; the UI at mobile widths; the GitHub CI run (it runs once the repo is pushed).

## Red-team review: what it found and what changed

| Finding                                                                                     | Severity | Outcome                                                                                                             |
| ------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| Draft headers overstated Ansh's part ("Ansh + Claude", "discussed in our chat")             | High     | **Fixed:** the provenance lines now match the chat (commit `8c654c7`)                                               |
| Ansh's own time not filled; one time row miscounted                                         | High     | **Fixed:** row corrected and Ansh's time added (below)                                                              |
| The repo must be private (the chat shows a plan to make it public)                          | High     | Flagged to Ansh as the first action before submitting                                                               |
| FDSK-169 refused any payment that had funded credit, e.g. after a return                    | Medium   | **Fixed:** withdraw unused funding after confirmation; refuse used credit with instructions                         |
| Rulebook descriptions can drift from behavior; "51 declarations" overstated coverage        | Medium   | **Partly fixed:** an invariant text was corrected, and RULES.md and the decision tree now say what stays imperative |
| Doc claims overstated (files touched per action, invariants "built", upgrade test coverage) | Medium   | **Fixed** in these notes, the decision tree and the final architecture                                              |
| No ambiguity questions                                                                      | Low      | **Fixed** for FDSK-169 (credit withdrawal). FDSK-170 still assumes missing units are in transit (documented)        |
| New receipt at the payer is dated at the move, not the original payment                     | Low      | Documented limitation                                                                                               |
| Moved-in-then-out receipt label; customer edit form role list                               | Low      | **Fixed**                                                                                                           |
| Payer customer's version is not checked                                                     | Low      | Documented; actions are serialized in one SQLite transaction                                                        |
| Some commits were split from one working tree                                               | Low      | Both intermediate commits were tested afterwards (see above)                                                        |

## Honesty notes

- **Who wrote what.** Claude wrote the code, tests and documents in this session. Ansh made the decisions in the chat:
  - co-write the first architecture draft;
  - let the agent propose the direction, since he didn't know which approach to take;
  - let the agent proceed autonomously and explain each step.

  He contributed no text to the drafts. Each draft states its provenance, corrected after the red-team review. The full chat history is committed.

- **v1 was wrong about the codebase.** It assumed if/else spaghetti. v2 records that the code was cleanly layered, and that the real problem was rules scattered and copied across files.
- **A did not save lines for these two stories.** Both solutions needed about 500 lines. The rulebook's payoff is in the next rule change and in being able to review the rules ([two-solutions.md](docs/solution/two-solutions.md)).
- **Dropped from the plan.** v3 promised an automatic count of permitted (role, action, status) combinations. It was dropped because it needed a second mapping that would duplicate code.
- **Not everything is declarative.** Permissions, follow-ups, statuses and post-conditions are declared. Cash allocation order (ACC-003), the WF-003 release, reward derivation and credit rules remain code, each in one place.
- **One amended commit.** On the Solution B branch, one commit was amended seconds after it was made, to fix a type error before anything was built on top of it. No other history was rewritten.

## AI workflow

1. **Master prompt.** Ansh supplied a prompt with eight review pillars (problem understanding, correctness, architecture, product, originality, execution, communication, reliability). It is in the chat history.
2. **Intake before design.**
   - Extract requirements and the rubric from the PDF.
   - Clone the repo and run the baseline suite (251/251).
   - Ask about anything that changes the outcome. For example, the agent flagged that a _public_ repo would disqualify the submission, as the PDF says.
3. **Commit architecture drafts as they are written**, with provenance.
4. **Refactor without changing behavior**, in small commits, running the full suite after every step. Then add features on top.
5. **Test the tests.** After writing the new tests, break the implementation on purpose and confirm the tests fail for the right reason.
6. **Verify in a browser** with Playwright and keep screenshots.
7. **Generate documents from code** (RULES.md), with a test so they can't drift.
8. **Independent red-team review** by a fresh agent, then fix and disclose what it found.
9. **Hand off** with a git bundle (full history, both branches), so Ansh can push to his own private repo without sharing credentials.

## Time spent

**Agent session**, from the chat transcript and commit timestamps (IST):

| When               | What                                                                                               | Duration (approx.) |
| ------------------ | -------------------------------------------------------------------------------------------------- | ------------------ |
| 27 Oct 19:05–19:15 | Read the PDF, clone and run the repo (baseline 251/251), intake, questions                         | 10 min             |
| 27 Oct 21:38–21:45 | Answers received; repo-visibility issue raised; follow-up questions                                | 7 min              |
| 28 Oct 00:56–01:02 | Architecture v1, deep code read, v2, research, v3                                                  | 6 min              |
| 28 Oct 01:02–01:22 | Framework refactor: rulebook, settlement, lifecycles, invariants                                   | 20 min             |
| 28 Oct 01:22–01:48 | FDSK-170, FDSK-169, multi-customer dispatch, UI and browser checks                                 | 26 min             |
| 28 Oct 01:48–02:15 | RULES.md generator, decision tree, Solution B, comparison, final architecture, upgrade test, notes | 27 min             |
| 28 Oct 02:15–02:50 | Red-team review, provenance fix, credit-funding withdrawal, UI fixes, doc corrections              | 35 min             |

**Ansh's own time:**

| Activity                                  | Time     |
| ----------------------------------------- | -------- |
| Reading the assignment and repo docs      | 6 hours  |
| Decisions and review in the chat          | 3 hours  |
| Reviewing code and docs before submission | 10 hours |
| Preparing for the discussion call         | 3 hours  |

## Chat history (deliverable 5)

The full conversation with the coding agent is in [docs/solution/chat-history.md](docs/solution/chat-history.md). It was exported from the session transcript: Ansh's messages, the agent's messages, questions and answers, and tool calls with shortened outputs.

## Run it

```sh
pnpm install && pnpm env:setup && pnpm db:migrate && pnpm admin:create && pnpm db:seed
pnpm dev                 # http://localhost:5173
pnpm test                # 262 tests
pnpm rules:doc           # regenerate docs/solution/RULES.md
git checkout solution-b/plain-services && pnpm test   # Solution B, 259 tests
```
