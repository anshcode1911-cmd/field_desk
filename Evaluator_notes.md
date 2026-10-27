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

| Area            | Result                                                                                                                                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rules framework | A shared rulebook (who / says / then / rule ids per action), first-hit lifecycle tables, 14 named invariants checked before every commit, and one settlement module for the money arithmetic and the WF-003 release. Server and client both use it. |
| FDSK-170        | `CORRECT_DELIVERY` (KAM): linked reversals of the newest confirmations, charge adjustments, release of excess settlement, shipment reopened, points re-derived.                                                                                     |
| FDSK-169        | `MOVE_PAYMENT` (Accounts): release at the wrong customer, linked transfer and new receipt at the payer, allocation there, points recovered, both customers audited and checked.                                                                     |
| UI              | "Correct delivered quantity" on shipments and "Wrong customer?" on payments, both tried in a browser ([screenshots](docs/solution/screenshots/)).                                                                                                   |
| Bonus           | Solution B on branch `solution-b/plain-services`, passing the same story tests.                                                                                                                                                                     |

The assumptions behind both stories are listed in [the final architecture, §6](docs/solution/architecture/04-final.md#6-the-two-stories-assumptions-and-behavior).

## Verification (all actually run)

| Check                                                             | Result                                                                                                                                                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test` on `main`                                             | **260 / 260** (251 original + 8 story tests + 1 RULES.md sync test). The 251 original tests were run after every refactor commit.                                                                 |
| `pnpm test` on `solution-b/plain-services`                        | **259 / 259**                                                                                                                                                                                     |
| `pnpm lint`, `pnpm typecheck`, `prettier --check .`, client build | Clean                                                                                                                                                                                             |
| Mutation checks (deliberately broke the code, then restored it)   | Disabling the delivery-correction release failed 3 tests with "ACC-001"; dropping the payment-move allocation release failed with "ACC-002"; dropping the second affected customer failed 2 tests |
| Upgrade of an existing database                                   | Seeded the original repo (migrations 0000–0005, 10 customers), then applied 0006–0007 from `main`: all 24 deliveries were kept, and 258/258 review checks passed                                  |
| Browser                                                           | Both flows run with Playwright against seeded data. Balance checks stayed 27/27 after the payment move. Role-gated buttons were checked for the Admin, Sales, Warehouse and Accounts desks        |

**Not verified:** behavior under real concurrent load beyond the existing concurrency tests; the UI on mobile widths; the GitHub CI run (it runs once the repo is pushed).

## Honesty notes

- **Who wrote what.** Claude wrote the code, tests and documents in this session. Ansh made the scoping decisions in the chat:
  - co-write the first architecture draft rather than write it alone;
  - let the agent propose the first-draft direction, since he didn't know which approach to take;
  - let the agent proceed autonomously and explain each step.

  Each architecture draft states its provenance at the top. The full chat history is committed (see below).

- **v1 was wrong about the codebase.** It assumed if/else spaghetti. v2 records that the code was cleanly layered, and that the real problem was rules scattered and copied across files.
- **A did not save lines for these two stories.** Both solutions needed about 500 lines for the stories. The rulebook's payoff is in the next rule change and in being able to review the rules ([two-solutions.md](docs/solution/two-solutions.md)).
- **Dropped from the plan.** v3 promised an automatic count of permitted (role, action, status) combinations. It was dropped because it needed a second mapping that would duplicate code. RULES.md reports declarations against the naive count instead.
- **Refused rather than guessed.** Moving a payment that funds a credit note is refused with an explanation. The canonical rules have no way to withdraw credit funding.
- **One amended commit.** On the Solution B branch, one commit was amended seconds after it was made, to fix a type error before anything was built on top of it. No other history was rewritten.

## AI workflow

1. **Master prompt.** Ansh supplied a prompt with eight review pillars (problem understanding, correctness, architecture, product, originality, execution, communication, reliability). It is in the chat history.
2. **Intake before design.** Extract requirements and the rubric from the PDF, clone the repo, run the baseline suite (251/251), and ask about anything that changes the outcome.
   - **Example:** the agent flagged that a _public_ repo would disqualify the submission, as the PDF says, and recommended private plus collaborator invites.
3. **Commit architecture drafts as they are written**, with provenance: before the code read, after it, and after research.
4. **Refactor without changing behavior**, in small commits. Run the full 251-test suite after every step, then add features on top.
5. **Test the tests.** After writing the new tests, break the implementation on purpose and confirm the tests fail for the right reason.
6. **Verify in a browser** with Playwright and keep screenshots.
7. **Generate documents from code where possible** (RULES.md), and guard them with a test so they can't drift.
8. **Hand off** with a git bundle (full history, both branches), so Ansh can push to his own private repo without sharing credentials.

## Time spent

**Agent session**, from the chat transcript and commit timestamps (IST):

| When               | What                                                                                                     | Duration (approx.) |
| ------------------ | -------------------------------------------------------------------------------------------------------- | ------------------ |
| 27 Oct 19:05–19:15 | Read the PDF, clone and run the repo (baseline 251/251), intake, questions                               | 10 min             |
| 27 Oct 21:38–21:45 | Answers received; repo-visibility issue raised; follow-up questions                                      | 7 min              |
| 28 Oct 00:56–01:02 | Architecture v1, deep code read, v2, research, v3                                                        | 10 min             |
| 28 Oct 01:02–01:22 | Framework refactor: rulebook, settlement, lifecycles, invariants                                         | 20 min             |
| 28 Oct 01:22–01:48 | FDSK-170, FDSK-169, multi-customer dispatch, UI and browser checks                                       | 26 min             |
| 28 Oct 01:48–02:15 | RULES.md generator, decision tree, Solution B, comparison, final architecture, upgrade test, these notes | 27 min             |

**Ansh's own time:** <!-- TODO(Ansh): replace with your real numbers before submitting, e.g. reading the brief, answering the agent, reviewing the docs and code, preparing for the call. -->

| Activity                                  | Time      |
| ----------------------------------------- | --------- |
| Reading the assignment and repo docs      | _to fill_ |
| Decisions and review in the chat          | _to fill_ |
| Reviewing code and docs before submission | _to fill_ |
| Preparing for the discussion call         | _to fill_ |

## Chat history (deliverable 5)

The full conversation with the coding agent is in [docs/solution/chat-history.md](docs/solution/chat-history.md). It was exported from the session transcript: user messages, the agent's messages, and tool calls with shortened outputs.

## Run it

```sh
pnpm install && pnpm env:setup && pnpm db:migrate && pnpm admin:create && pnpm db:seed
pnpm dev                 # http://localhost:5173
pnpm test                # 260 tests
pnpm rules:doc           # regenerate docs/solution/RULES.md
git checkout solution-b/plain-services && pnpm test   # Solution B, 259 tests
```
