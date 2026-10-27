# Solution B: the two user stories without a framework

This branch (`solution-b/plain-services`) is the **low-framework** end of the trade-off, the bonus in deliverable 2. It starts from the original repository (`63fbc8f`) and implements FDSK-169 and FDSK-170 in the codebase's existing style:

- each service method checks its own role (`authorize`);
- each method checks status inline;
- each method calls its own follow-ups (`allocateCash`, `rewards.refresh`).

The main branch holds Solution A (rulebook, shared settlement policies, lifecycle tables, named invariants).

Both solutions share the same migrations, models, request schemas, and **the same `server/test/corrections.test.ts`**. All 8 story tests and the 251 original tests pass on both branches, so the comparison is about structure, not behavior.

## What B had to do differently

| Concern                                              | Solution B (this branch)                                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Who may act                                          | 2 more `authorize(...)` calls (22 in services)                                                  |
| WF-003 release of cash → credit → points             | A second ~75-line copy of the block in `ReturnsService`, inside `correctDelivery`               |
| Receipt capacity after a move (`amount − moved out`) | Patched in 5 places: allocation, account summary, credit issue, audit review, received-cash SQL |
| Follow-ups for two customers                         | `movePayment` swaps `c.customerId` between calls to refresh and allocate                        |
| Shipment status                                      | Inline `status !== 'DISPATCHED' && status !== 'DELIVERED'` checks                               |
| Rules a non-technical reader can see                 | None beyond the code and canonical docs                                                         |

## Size (measured with `git diff --numstat`, code only)

| Change                                                  | Files | Lines added / removed |
| ------------------------------------------------------- | ----- | --------------------- |
| Shared foundation (schemas, models, repository queries) | 7     | +208 / −6             |
| The two stories' service and dispatcher code            | 7     | +301 / −29            |

See `docs/solution/two-solutions.md` on the main branch for the side-by-side comparison with Solution A.
