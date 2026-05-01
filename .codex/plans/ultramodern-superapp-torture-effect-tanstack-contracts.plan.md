---
name: UltraModern SuperApp Torture Effect TanStack Contracts
overview: Prove the target Effect plus TanStack architecture under cancellation, retries, optimistic updates, rollback, query invalidation, schema boundaries, and request-context propagation.
todos:
  - id: ust-contract-01
    content: "Map the Effect BFF contracts, TanStack Router paths, TanStack Query cache keys, mutations, and invalidation boundaries used by the SuperApp portfolio."
    status: completed
  - id: ust-contract-02
    content: "Add contract tests for successful reads, writes, optimistic mutation, rollback, duplicate request idempotency, abort/cancellation, timeout, and retry classification."
    status: completed
  - id: ust-contract-03
    content: "Verify Effect interruption, scoped finalizers, schema decode failures, structured defects, and request context propagation across BFF handlers."
    status: completed
  - id: ust-contract-04
    content: "Verify TanStack Router and Query behavior for navigation invalidation, stale data, prefetch, mutation rollback, tenant switch, and offline-to-online recovery."
    status: completed
  - id: ust-contract-05
    content: "Emit a contract coverage artifact that names every contract, scenario, expected behavior, and regression budget."
    status: pending
isProject: true
---

# UltraModern SuperApp Torture Effect TanStack Contracts

## Execution Notes

This lane is the architectural center of the next wave. It should validate that the intended Effect-first BFF and TanStack client model works under real SuperApp pressure, not only under happy-path integration.

Use existing route and BFF patterns wherever possible. Add helpers only when they reduce repeated contract boilerplate or make cancellation, finalizers, and cache behavior observable.

Prefer crisp contract tests over broad snapshots. For each contract, state the expected state transition, emitted error shape, cache result, and cleanup behavior.

## Constraints

Do not couple tests to incidental implementation details such as exact internal object identity unless the contract truly requires it.

Keep server-only Effect behavior and browser-visible TanStack behavior distinguishable in artifacts. A failure should say whether the server contract, client cache contract, router contract, or integration boundary broke.

## Operator Guidance

Suggested ownership is Effect BFF contract tests, TanStack Router/Query test harnesses, and scenario adapters in the SuperApp portfolio.

Conflict risk is highest with browser and chaos lanes. Reuse failure IDs, tenant IDs, and scenario IDs from workload-data and chaos instead of creating duplicate variants.

Exit criteria: the target stack has explicit tests for cancellation, rollback, invalidation, schema boundaries, context propagation, and retry/idempotency behavior.
