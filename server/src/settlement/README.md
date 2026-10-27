# Settlement

Owns the shared settlement arithmetic and the WF-003 release policy. It has no tables or controller.

## Implementation

- [settlement.service.ts](settlement.service.ts): `charge` (ACC-001 retained value, cash, credit, points, outstanding), `receipt` (ACC-002 received less moved out, allocated, reserved, free), `credit` (CRD-001 issued as net funding, applied, refunded, open), and `releaseOverSettlement` (WF-003: release cash, then credit, then points above a reduced charge's retained value, newest source first, back to the original sources).
- [settlement.module.ts](settlement.module.ts): Imports only the Accounts, Credits, and Rewards repositories, so any service can use it without circular dependencies.

## Coordination

Accounts uses it for allocation, summaries, and payment moves; Credits and Rewards use it for application, refund, and redemption limits; Audit for the receipt invariant, and Returns for return settlement. Writes join the Actions transaction.

## Related

- [Backend module index](../README.md)
