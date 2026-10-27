# Fulfillment

Owns physical shipments, loading quantities, dispatch evidence, incremental delivery confirmations and their corrections, and authorized dispatch supplements.

## Implementation

- [fulfillment.model.ts](fulfillment.model.ts): Shipment, shipment-line, delivery (including linked reversals), and correction mappings; deliverable and correctable quantity validation.
- [fulfillment.repository.ts](fulfillment.repository.ts): Typed physical-document persistence and loaded, dispatched, and delivered quantity reads.
- [fulfillment.service.ts](fulfillment.service.ts): Prepare, dispatch, confirm delivery, correct an overstated delivery (FDSK-170), append an authorized dispatch supplement, and list shipments.
- [fulfillment.controller.ts](fulfillment.controller.ts): Authenticated shipment reads for an order.

## Coordination

Orders owns commercial revisions and approvals. Delivery appends an Accounts charge; the rulebook then runs cash allocation and reward refresh. A dispatch supplement retains the original physical document and records its supporting facts. A delivery correction reverses the newest confirmations with linked negative deliveries, adjusts each one's own charge, and asks Settlement to release cash, credit, and points above the reduced charge; the rulebook then refreshes rewards. Returns owns goods coming back after delivery. Mutating methods receive the Actions context and run inside its transaction; loading or dispatch alone does not create a receivable.

## Related

- [Backend module index](../README.md)
