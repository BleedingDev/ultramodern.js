# Release v4.0.0 Backport Plan (Super-App Streams)

- Status: Active (stream-by-stream backport)
- Date: 2026-02-21
- Scope: Backport feasibility and staged execution from `codex/effect-v4-readiness` to `release-v4.0.0`

## 1. Current State

- `codex/effect-v4-readiness` contains the validated super-app stream implementation work.
- Divergence from `release-v4.0.0` is large:
  - left/right count (`release-v4.0.0...codex/effect-v4-readiness`): `1 / 2472`
  - merge-base: `3304d33c3aa1429573fa07b189a350e3558dc07b`

## 2. Decision

Do not perform a direct merge into `release-v4.0.0` in a single step.

Instead, run a dedicated backport program with explicit stream-by-stream cherry-pick/adaptation and isolated validation gates.

## 3. Why Direct Merge Is Unsafe

- Massive historical divergence causes high conflict volume and high hidden regression risk.
- Runtime/build/test infrastructure differs substantially between the branches.
- A one-shot merge would make rollback and root-cause isolation difficult.

## 4. Backport Execution Strategy

1. Create backport branch from `release-v4.0.0`.
2. Backport by stream in this order:
   - Stream A: RsDoctor defaults (builder-only).
   - Stream B: Cross-project BFF hardening.
   - Stream C: Telemetry standardization/exporters.
   - Stream D: MF data-fetch reliability tests.
   - Stream E: App-level MF SSR alpha contracts (only if branch capabilities support it).
3. After each stream:
   - adapt code paths to v4 branch APIs.
   - run stream-specific tests.
   - commit with isolated scope.
4. Final integration pass:
   - targeted package tests.
   - integration suites relevant to backported streams.

## 5. Parallel vs Sequential

- Parallelizable:
  - feasibility spikes for Streams A/B/C.
  - documentation and test matrix drafting.
- Sequential (required):
  - final code backports and test gates per stream.
  - Stream E depends on successful Stream B/D outcomes.

## 6. Exit Criteria

- Each accepted stream has:
  - passing targeted tests on backport branch.
  - explicit changelog notes for behavior differences versus `codex/effect-v4-readiness`.
- No broad merge commit from `codex/effect-v4-readiness` to `release-v4.0.0`.

## 7. Stream Progress (2026-02-21)

- Stream A: Implemented.
  - Backported default-on RsDoctor config and wiring with passing builder tests.
- Stream B: Implemented (release-v4-compatible subset).
  - Backported request-id scoped cross-project BFF/create-request hardening.
- Stream C: Implemented (release-v4-adapted).
  - Added telemetry envelope registry, OTLP exporter, and VictoriaMetrics exporter in `prod-server`.
  - Added server telemetry config surface and tests.
- Stream D: Deferred on release-v4.
  - Full `routes-tanstack-mf` fixture backport was attempted and fails on release-v4 type/runtime contracts.
  - Hard blockers observed in typecheck: missing `@tanstack/react-router`, missing `@module-federation/modern-js-v3/runtime`, and `Response.json` static helper mismatch.
- Stream E: Partial backport.
  - Added alpha config/env contracts (`server.ssr.moduleFederationAppSSRAlpha`, `process.env.MODERN_MF_APP_SSR_ALPHA`).
  - Added runtime unit tests for alpha contract/global-var injection and updated SSR config docs (EN/ZH).
  - Full app-level MF SSR runtime path requires architecture not present in release-v4.
