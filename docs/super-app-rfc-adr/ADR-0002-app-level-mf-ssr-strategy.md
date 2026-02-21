# ADR-0002: App-Level Module Federation SSR Strategy

- Status: Implemented (Alpha)
- Date: 2026-02-21
- Decision Type: Runtime architecture

## 1. Context

Current docs state app-level MF modules exported/consumed through Bridge APIs are not SSR-capable. Super-app goals require SSR-capable composition at app-level boundaries without sacrificing independent deployment.

## 2. Decision

Adopt a phased SSR strategy for app-level MF:

1. Keep component-level SSR as stable baseline.
2. Add app-level MF SSR as alpha behind feature flag.
3. Promote after hydration consistency and fallback behavior are proven in integration tests.

## 3. Target Architecture

- Dual entry contract for remote app modules: server entry + client entry.
- Host SSR runtime resolves and renders remote server entry.
- Shared request-context propagation across host and remote:
  - auth/session context
  - locale/i18n context
  - trace context
- Deterministic fallback to CSR boundary when remote SSR fails.

## 4. Implementation Plan

1. Define SSR remote contract and manifest schema additions.
2. Implement host runtime adapter for loading remote server entries.
3. Implement hydration-safe boot payload contract.
4. Add fallback policy and typed error taxonomy.
5. Add integration test matrix:
  - dev and serve
  - remote unavailable
  - slow remote
  - hydration mismatch protection
6. Ship alpha feature flag.

## 5. Risks

- Hydration mismatch across host/remote boundaries.
- Runtime version skew between independently deployed remotes.
- Increased startup latency if remote SSR resolution is slow.

## 6. Mitigations

- Strict compatibility checks for host/remote shared runtime versions.
- Timeout + fallback-to-CSR policy.
- Startup caching for remote SSR metadata.

## 7. Parallelization

- Execution mode: Mostly Sequential.
- Depends on:
  - ADR-0005 (cross-project contract hardening).
  - ADR-0003 (data-fetch reliability baseline for federated boundaries).
- Can run in parallel:
  - contract design and RFC-level API definitions.
- Should run sequentially:
  - runtime implementation and rollout.

## 8. Acceptance Criteria

- Feature-flagged app-level MF SSR path works in dev and serve.
- No critical hydration regressions in test matrix.
- Remote SSR failure gracefully degrades to CSR with observability signals.

## 9. Implementation Notes (2026-02-21)

- Added alpha config flag: `server.ssr.moduleFederationAppSSRAlpha`.
- Added runtime define: `process.env.MODERN_MF_APP_SSR_ALPHA`.
- Added i18n MF integration coverage for:
  - dev SSR shell + hydration consistency.
  - remote-unavailable fallback boundary behavior.
  - serve-mode SSR shell + fallback boundary behavior.
- Added provider routing hardening for manifest endpoints by ignoring i18n locale redirect on:
  - `/mf-manifest.json`
  - `/mf-stats.json`
  - `/remoteEntry.js`
