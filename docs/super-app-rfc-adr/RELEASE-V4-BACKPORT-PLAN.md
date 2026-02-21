# Release v4.0.0 Backport Plan (Super-App Streams)

- Status: Proposed (separate program)
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
