# Actions

Owns the command execution boundary and persisted idempotency outcomes for CRM activities.

## Implementation

- [actions.model.ts](actions.model.ts): The `action_requests` table, including requester-scoped keys and stored results.
- [actions.repository.ts](actions.repository.ts): Request lookup, action lookup, and result persistence.
- [actions.service.ts](actions.service.ts): Actor verification, request fingerprints, version checks, rulebook permission checks, dispatch, follow-up policies, aggregate versions, and commit coordination.
- [handlers.ts](handlers.ts): Binds each rulebook action to the domain method that records its facts, and each rulebook reaction to its policy.
- [actions.controller.ts](actions.controller.ts): Validation and authenticated handling of `POST /api/crm/actions`.

## Coordination

Execution uses an immediate SQLite transaction with a nested savepoint. A rejected operation rolls back business writes while its request outcome can still be stored. Applied activities advance the customer and all of its order versions, append an event, and pass Audit checks before commit. The shared [rulebook](../../../shared/src/rulebook.ts) decides who may run each action and which follow-up policies (`allocate free cash`, `refresh rewards`) run after it, always in that order. Domain services own the actual order, fulfillment, finance, and reward operations and do not repeat role checks or follow-up calls. Browser clients, CLI seeding, and integration fixtures submit commands through this boundary.

## Related

- [Backend module index](../README.md)
