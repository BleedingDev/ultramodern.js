# UltraModern Data Platform Architecture (MF-safe)

This document defines a clean, greenfield data architecture for Fate-style orchestration while preserving Module Federation and micro-frontend interoperability.

## Goals

- One canonical data contract for requests, views, actions, hydration, and invalidation.
- Deterministic behavior across SSR/CSR and host/remote applications.
- Strong tenant/app isolation by default, explicit cross-app communication only.
- Protocol-level observability and integrity checks.

## Core Contracts

Implemented in `src/runtime/data-platform/index.ts`:

- Operation identity: `createOperationId`
- Cache/request scoping: `buildScopeKey`, `buildQueryKey`
- Selection safety: `validateSelectionPlan`
- Distributed tracing: `parseTraceparentHeader`, `formatTraceparentHeader`, `deriveChildTraceContext`
- Request envelope: `createRequestEnvelope`, `validateRequestEnvelope`
- Hydration integrity: `createHydrationEnvelope`, `validateHydrationEnvelope`
- Invalidation routing: `createInvalidationEvent`, `shouldApplyInvalidation`

## Mitigations Applied

1. Operation ID collisions
- IDs include namespace + api/group/endpoint + version + schema hash contribution.
- IDs are deterministic and hashed from canonical payloads.

2. Cross-app cache contamination
- Scope key includes normalized origin + app namespace + identity dimensions.
- Query keys include scope key and selection/input fingerprints.

3. Invalid selection pushdown
- Selection plans are depth-limited, field-limited, and optional allow-list validated.

4. Trace discontinuity across host/remotes
- Trace context is first-class and validated through W3C traceparent format.
- Child spans preserve trace id and parent linkage.

5. Hydration poisoning/staleness
- Hydration payloads include checksum over canonical serialized payload + metadata.
- Runtime/namespace/origin/protocol checks are validated.

6. Unintended cross-namespace invalidation
- Default: no cross-namespace invalidation.
- Cross-app invalidation requires explicit target namespace + opt-in subscriber.

## Test Strategy

Contract and scenario coverage is in `tests/data-platform-contract.test.ts`:

- Deterministic and collision-resistant operation IDs.
- Scope/query key isolation across namespaces and normalized origins.
- Selection validation guardrails (depth, count, allow-list, shape).
- Request envelope integrity and required trace context checks.
- Hydration checksum tamper detection.
- Invalidation routing policy enforcement.
- Simulated host/remote mutation and trace propagation scenarios.

This suite is intended to be the non-negotiable compatibility gate for future data-runtime changes.
