# Orders

Owns commercial orders, immutable line revisions, revision approvals and rejections, and canceled demand.

## Implementation

- [orders.model.ts](orders.model.ts): Order, revision, line, approval, and cancellation mappings; the ORD-003 edit guard, the current-revision review guard, and fulfillment status projection. Status changes follow `ORDER_LIFECYCLE` in the shared rulebook.
- [orders.repository.ts](orders.repository.ts): Typed commercial-document persistence, current-revision lookup, and order progress reads.
- [orders.service.ts](orders.service.ts): Create, edit, submit, approve, reject, cancel, and compose order list/detail views.
- [orders.controller.ts](orders.controller.ts): Authenticated order list and detail endpoints.

## Coordination

Catalog supplies product reference data. Fulfillment and Returns supply physical progress for detail views. Edits invalidate pending loading documents and compensate old locked entitlement. Approval posts locked entitlement; cancellation is followed by the rulebook's reward refresh. Actions supplies authorization context, idempotency, transaction boundaries, and versions. Order detail includes related records, while their storage and mutations remain owned by the corresponding modules.

## Related

- [Backend module index](../README.md)
