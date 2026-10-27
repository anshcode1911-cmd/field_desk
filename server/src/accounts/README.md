# Accounts

Owns receivable entries, customer cash receipts, receipt transfers between customers, payment allocations, and account balance projections.

## Implementation

- [accounts.model.ts](accounts.model.ts): Drizzle mappings for charges, receipts, receipt transfers, and allocations; the `ChargeBalance` value calculation.
- [accounts.repository.ts](accounts.repository.ts): Typed posting persistence, receipt attribution, and charge queries.
- [accounts.service.ts](accounts.service.ts): Receipt capture, moving a misattributed receipt to the paying customer (FDSK-169), FIFO cash allocation, account summaries, ledgers, and account list rows.
- [accounts.controller.ts](accounts.controller.ts): Authenticated account list, customer summary, and ledger reads.

## Coordination

`ActionsService` invokes `receive`, `allocate`, and `movePayment`, and runs `allocateCash` as the rulebook's `allocate free cash` reaction after the actions WF-002 lists. Rewards owns point balances and entitlement refresh; Credits owns credit funding and settlement. The account summary combines those sources without copying their balances into another table. Receipt capacity (received less moved out, allocated, reserved, free) comes from Settlement. `movePayment` makes the paying customer the action's subject and lists the original customer as also affected, so both are versioned, audited, and reviewed. Command writes join the action transaction; `accounts()` wraps its multi-customer read in a transaction.

## Related

- [Backend module index](../README.md)
