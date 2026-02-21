# ADR-0003: Effect-Only Module Federation Data-Fetch Reliability

- Status: Implemented
- Date: 2026-02-21
- Decision Type: Data contract and testing strategy

## 1. Context

MF integration tests already cover major host/remote interaction paths, but dedicated coverage for MF data-fetch fallback/error contracts is incomplete. Team direction is explicit: Effect-only approach, no Zod layer.

## 2. Decision

Standardize federated data-fetch integration around Effect runtime and Effect Schema only.

- No Zod integration in this workstream.
- Unified error taxonomy and fallback behavior for federated data fetch.
- Reliability-first test matrix for dev/build/serve modes.

## 3. Scope

- Remote loader resilience behavior and retries/timeouts.
- Federated data-fetch error fallback contracts.
- Manifest-level assertions for required data-fetch metadata.
- Failure injection for slow or failing remotes.

## 4. Implementation Plan

1. Add unit tests for remote loader timeout/retry/contract errors.
2. Add dedicated integration fixture for MF data-fetch and fallback behaviors.
3. Add serve-mode e2e tests with failure injection toggles.
4. Add manifest/contract assertions for emitted data-fetch metadata.
5. Add trace continuity assertions for data-fetch path.
6. Add CI gating for this suite.

## 5. Effect-Only Contract Guidelines

- Use Effect Schema for input/output validation at host/remote boundaries.
- Keep errors in typed tagged structures compatible with Effect runtime.
- Keep transport metadata explicit, including trace context and fetch correlation keys.

## 6. Parallelization

- Execution mode: Parallel-start, partial sequential.
- Depends on:
  - ADR-0005 partially (bootstrap/runtime assumptions in cross-project usage).
- Can run in parallel:
  - unit tests, fixture setup, failure-injection scaffolding.
- May require sequencing:
  - final integration contracts with ADR-0005 bootstrap finalization.

## 7. Acceptance Criteria

- Dedicated MF data-fetch suite passes in dev and serve modes.
- Failure-injection scenarios produce deterministic and typed fallbacks.
- Effect-only schema paths are enforced in test fixtures.
- No Zod dependency introduced by this stream.

## 8. Implementation Notes (2026-02-21)

- Routes MF reliability fixtures and deterministic failure injection are active for timeout/network/contract error paths.
- Distributed OTEL trace continuity checks are enabled in both build and serve integration modes.
- Effect-only typed contracts remain enforced; this stream introduced no Zod dependency.
- Validation coverage:
  - `tests/integration/routes-tanstack-mf/test/index.test.ts`
  - `tests/integration/routes-tanstack-mf/test/remote-loader-reliability.test.ts`
  - `pnpm --dir tests test:framework -- integration/routes-tanstack-mf/test/index.test.ts --runInBand`
