# ADR-0005: Cross-Project BFF Hardening

- Status: Implemented
- Date: 2026-02-21
- Decision Type: Reliability and DX hardening

## 1. Context

Cross-project BFF already generates SDK, runtime, and plugin artifacts. Current behavior is functional, but there are avoidable error-prone paths around config override, package metadata mutation, bootstrap sequencing, and watch coverage.

## 2. Decision

Harden cross-project BFF with fail-fast validation, safer generation, and explicit bootstrap/runtime contracts.

## 3. Key Changes

1. Promote prefix conflicts from warning to build-time error.
2. Add explicit consumer bootstrap (`initProducerClient`) requirement and guard.
3. Make generated metadata merge deterministic and conflict-aware.
4. Add runtime compatibility checks (`hono`/`effect` expectations).
5. Expand file-watch coverage for SDK regeneration.

## 4. Implementation Plan

1. Validation:
  - enforce prefix policy during compile/startup
  - provide actionable error messages
2. SDK bootstrap contract:
  - generate typed init function
  - fail early if API called before initialization
3. Metadata safety:
  - introduce deterministic merge utility for `package.json` exports/types/files
  - detect collisions and fail fast
4. Runtime compatibility:
  - include producer runtime metadata in generated package
  - verify on consumer startup
5. Watch robustness:
  - include more source extensions and relevant generated artifacts
  - add stale-generation detection
6. Testing:
  - integration tests for conflict/failure scenarios
  - ensure cross-project happy path remains stable

## 5. Parallelization

- Execution mode: Parallel, should start early.
- Depends on: None.
- Blocks:
  - ADR-0002 implementation stage.
  - ADR-0003 final integration assumptions.

## 6. Acceptance Criteria

- Prefix conflict produces hard error, not warning.
- Consumer API usage before bootstrap fails with clear typed error.
- Metadata collision is detected and surfaced deterministically.
- Regeneration updates SDK reliably for supported source changes.

## 7. Implementation Notes (2026-02-21)

- Prefix mismatch is now a hard validation error in cross-project BFF plugin wiring.
- Runtime framework compatibility mismatch (`hono` vs `effect`) is validated early and fails fast.
- Generated runtime exposes explicit `initProducerClient` bootstrap API (with `configure` alias).
- Package metadata merge now performs deterministic conflict checks for `exports` and `typesVersions`.
- Consumer pre-bootstrap request usage is guarded by runtime `create-request` checks and tested.
- Validation coverage:
  - `packages/cli/plugin-bff/tests/cross-project-api-plugin.test.ts`
  - `packages/cli/plugin-bff/tests/regression.test.ts`
  - `packages/server/create-request/tests/node.test.ts`
  - `pnpm --filter @modern-js/plugin-bff test -- cross-project-api-plugin.test.ts regression.test.ts`

## 8. Compatibility Notes (2026-02-22)

Behavior change for producer clients:

1. Non-default `requestId` configuration now requires `setDomain()` (fail-fast at `configure()` and request send).
2. Generated SDK includes `initProducerClient` to make bootstrap explicit and less error-prone.
3. Migration guidance:
   - Before: `configure({ requestId: 'producer-a' })`
   - Now: `initProducerClient({ setDomain: () => 'https://producer-a.internal' })` or `configure({ requestId: 'producer-a', setDomain: ... })`
4. Legacy default `requestId` flows remain backward compatible.

## 9. Envelope Policy Notes (2026-02-22)

1. Cross-project non-default producer calls now support `requireEnvelope` and `allowCrossOriginEnvelope` policy controls.
2. In production, non-default `requestId` flows default to `requireEnvelope = true` unless explicitly overridden.
3. Cross-origin envelope traffic is deny-by-default in production and requires explicit policy (`allowCrossOriginEnvelope`).
4. Secure header propagation remains allowlist-based (`allowedHeaders`) and resolver outputs are constrained to that allowlist.

## 10. Transport Resilience Notes (2026-02-22)

1. Producer transport now supports opt-in resilience controls through `configure({ transport: ... })`.
2. Resilience policy includes:
  - request timeout (`timeoutMs`) with abort semantics where supported
  - bounded retry with exponential backoff (`retry.retries`, `baseDelayMs`, `maxDelayMs`, `jitterRatio`)
  - optional status-code retry policy (`retryableStatusCodes`) or custom decision (`shouldRetry`)
3. Degraded-mode events can be emitted through `transport.onDegraded` with reasons:
  - `timeout`
  - `retry`
  - `retry_exhausted`
4. Behavior remains backward compatible by default:
  - no timeout unless configured
  - no retries unless configured
5. Validation coverage:
  - `packages/server/create-request/tests/node.test.ts`
  - `packages/server/create-request/tests/browser.test.ts`
  - `pnpm --filter @modern-js/create-request test`

## 11. Effect + TanStack Integration Regression Notes (2026-02-22)

1. Added integration-level contract regression suites for Effect-first cross-project BFF generated clients and TanStack generated router data-flow adapters.
2. Coverage includes:
  - Effect data-platform client generation contracts:
    - batch transport bootstrap hooks
    - request-envelope header preparation and strict fallback guard
    - producer `requestId` bootstrap wrapper contract
    - operation manifest emission
  - TanStack router generation contracts:
    - Modern loader -> TanStack loader bridge
    - AbortSignal propagation
    - redirect/notFound mapping semantics
    - splat parameter mapping branch (`_splat` -> `*`)
3. Validation coverage:
  - `tests/integration/bff-runtime-parity/tests/effect-only-data-platform.test.ts`
  - `tests/integration/routes-tanstack/tests/tanstack-data-flow-contract.test.ts`
  - local command: `pnpm --filter tests exec jest ... --config '{\"testEnvironment\":\"node\",...}'`

## 12. Server-Derived Identity Binding Notes (2026-02-22)

1. Added identity binding contract to producer request runtime (`@modern-js/create-request`) for non-default producer clients.
2. Identity binding defaults:
  - enabled by default for non-default `requestId` flows
  - protected headers: `x-tenant-id`, `x-subject-id`, `x-user-id`, `x-operation-id`
3. Security behavior:
  - client-supplied protected headers are blocked by default
  - server-derived headers (incoming request context / custom `deriveHeaders`) take precedence
  - optional strict mode rejects attempts via `IdentityBindingViolationError`
4. New runtime options:
  - `identityBinding.strict`
  - `identityBinding.protectedHeaders`
  - `identityBinding.deriveHeaders`
  - `identityBinding.onViolation`
5. Validation coverage:
  - `packages/server/create-request/tests/node.test.ts`
  - `packages/server/create-request/tests/browser.test.ts`
  - command: `pnpm --filter @modern-js/create-request test -- --runInBand`

## 13. Cross-Project Policy Middleware Notes (2026-02-22)

1. Added shared cross-project policy evaluator in `@modern-js/bff-core`:
   - validates envelope structure for producer traffic
   - validates producer namespace against optional allowlist
   - validates operation-context consistency (`x-operation-id`)
   - returns explicit deny reasons with deterministic status codes
2. Added framework-level enforcement middleware in both API runtimes:
   - `@modern-js/plugin-express`
   - `@modern-js/plugin-koa`
   - deny responses use explicit policy error payload (`BFF_CROSS_PROJECT_POLICY_DENIED`)
3. Added config surface under `bff.crossProjectPolicy`:
   - `enabled`
   - `requireEnvelope`
   - `requireOperationContext`
   - `allowedNamespaces`
   - `denyStatus`
4. Non-default producer request clients now auto-emit operation context headers:
   - `x-operation-id`
   - `x-modernjs-bff-operation-context`
5. Validation coverage:
   - `packages/server/bff-core/tests/crossProjectPolicy.test.ts`
   - `packages/server/create-request/tests/node.test.ts`
   - `packages/server/create-request/tests/browser.test.ts`
   - `packages/server/plugin-express/tests/*.test.ts`
   - `packages/server/plugin-koa/tests/*.test.ts`

## 14. Audit Context Propagation Notes (2026-02-22)

1. Standardized audit correlation envelope across producer requests:
   - operation context header: `x-operation-id`
   - detailed operation context header: `x-modernjs-bff-operation-context`
   - trace propagation header: `traceparent`
2. Operation context payload now includes correlation identifiers:
   - `requestId`
   - `operationId`
   - `routePath`
   - `method`
   - optional schema identifiers (`schemaHash`, `operationVersion`)
   - optional trace identifiers (`traceparent`, `traceId`, `spanId`)
3. Trace behavior:
   - Node runtime forwards incoming `traceparent` into producer calls when available.
   - Browser runtime preserves explicit `traceparent` when provided via operation context or request headers.
   - Envelope metadata includes parsed `traceId`/`spanId` when trace context exists.
4. Tenant/subject identity remains server-derived for non-default producer clients through identity binding.
5. Validation coverage:
   - `packages/server/create-request/tests/node.test.ts`
   - `packages/server/create-request/tests/browser.test.ts`
   - command: `pnpm --filter @modern-js/create-request test`
