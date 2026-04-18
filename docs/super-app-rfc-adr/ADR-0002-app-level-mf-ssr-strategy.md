# ADR-0002: App-Level Module Federation SSR Strategy

- Status: Implemented (Stable contract defaults)
- Date: 2026-02-21
- Decision Type: Runtime architecture

## 1. Context

Current docs state app-level MF modules exported/consumed through Bridge APIs are not SSR-capable. Super-app goals require SSR-capable composition at app-level boundaries without sacrificing independent deployment.

## 2. Decision

Adopt an SSR strategy for app-level MF:

1. Keep component-level SSR as stable baseline.
2. Enable app-level MF SSR stable contract/env wiring when server-rendered MF markers are detected.
3. Keep explicit opt-out controls for staged rollout in sensitive environments.

## 3. Target Architecture

- Dual entry contract for remote app modules: server entry + client entry.
- Host SSR runtime resolves and renders remote server entry.
- Shared request-context propagation across host and remote:
  - auth/session context
  - locale/i18n context
  - trace context
- Deterministic fallback to CSR boundary when remote SSR fails.

## 3.1 Contract Invariants

- The host owns shell SSR, request capture, remote resolution, and the decision to fall back.
- Remotes own only their app-level boundary and must stay independently deployable through a stable server-entry plus client-entry pair.
- The host forwards request context into the remote SSR entry, including locale and trace information, so remote loaders and views render against the same request boundary.
- If remote SSR is unavailable, incompatible, times out, or throws, the host must render a deterministic CSR boundary instead of partially hydrating a broken remote tree.
- Compatibility is defined by the manifest and entry contract, not by shared deployment timing; host and remote can move independently as long as the dual-entry shape and request-context handoff remain intact.

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
6. Ship stable defaults + opt-out switch.

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

- App-level MF SSR stable path works in dev and serve.
- Host SSR, remote SSR, request-context propagation, and locale/trace handoff remain observable through the contract tests.
- No critical hydration regressions in test matrix.
- Remote SSR failure gracefully degrades to CSR with observability signals.

## 9. Implementation Notes (2026-02-21)

- Added app-level MF SSR config flag: `server.ssr.moduleFederationAppSSR`.
- Added runtime define: `process.env.MODERN_MF_APP_SSR`.
- Added i18n MF integration coverage for:
  - dev SSR shell + hydration consistency.
  - remote-unavailable fallback boundary behavior.
  - serve-mode SSR shell + fallback boundary behavior.
- Added provider routing hardening for manifest endpoints by ignoring i18n locale redirect on:
  - `/mf-manifest.json`
  - `/mf-stats.json`
  - `/remoteEntry.js`

## 10. Runtime Compatibility Handshake Notes (2026-02-22)

- Added host/remote runtime digest handshake support in `@modern-js/plugin-garfish` runtime:
  - host policy: `runtimeCompatibility.hostDigest`
  - mode: `off | warn | strict` (default `strict` when host digest is configured)
  - optional callback: `runtimeCompatibility.onIncompatible(issue)`
- Exposed runtime digest metadata in remote entry/provider contract:
  - `provider.runtimeMetadata.runtimeDigest`
  - `__GARFISH_EXPORTS__.runtimeMetadata.runtimeDigest`
  - `__GARFISH_EXPORTS__.runtimeDigest` (compatibility alias)
- Exposed remote entry integrity metadata in remote entry/provider contract:
  - `provider.runtimeMetadata.integrity`
  - `__GARFISH_EXPORTS__.runtimeMetadata.integrity`
- Added config surface for remote artifacts:
  - `deploy.microFrontend.runtimeDigest` -> emitted as `process.env.MODERN_MF_RUNTIME_DIGEST`
  - `deploy.microFrontend.integrity` -> emitted as `process.env.MODERN_MF_REMOTE_ENTRY_INTEGRITY`
- Added remote trust enforcement policy in runtime config:
  - `remoteTrust.allowedOrigins`
  - `remoteTrust.requireIntegrity`
  - `remoteTrust.verifyIntegrity`
  - `remoteTrust.integrityFetchTimeoutMs`
  - `remoteTrust.mode` (`off | warn | strict`) and production-only enforcement default
- Added structured MF fallback telemetry contract:
  - taxonomy: `runtime_incompatible`, `origin_not_allowed`, `integrity_*`, `integrity_timeout`, `remote_*_failed`
  - phase: `bootstrap | compatibility | integrity | load | mount | unmount`
  - payload fields: `reason`, `phase`, `appName`, `entry`, `message`, `code`, `timestamp`, `metadata`
  - emitters:
    - callback hook: `fallbackTelemetry.onFallback`
    - browser event: `fallbackTelemetry.eventName` (default `modernjs:mf-fallback`)
- Remote digest sources are resolved in order:
  1. app-level `runtimeDigest`
  2. app-level `runtimeMetadata.runtimeDigest`
  3. manifest-level `runtimeDigest`
  4. injected `window.modern_manifest.runtimeDigest`
- In `strict` mode, mismatched or missing remote digest raises a hard failure before app registration.
- In `warn` mode, incompatibilities are emitted through callback/logger without blocking registration.

## 11. Remote Trust Hardening Notes (2026-02-22)

- Extended remote trust policy with strict origin isolation controls:
  - `remoteTrust.isolatedOrigins` (`Record<appName, origin>`) for per-app origin pinning.
  - `remoteTrust.singleOriginIsolation` for same-origin enforcement across all configured remotes.
- Extended remote trust policy with attestation controls:
  - `remoteTrust.requireAttestation` to require attestation metadata on remotes.
  - `remoteTrust.attestations` (`Record<appName, token>`) for expected token matching.
- Extended remote metadata contract:
  - `provider.runtimeMetadata.attestation`
  - `__GARFISH_EXPORTS__.runtimeMetadata.attestation`
- Extended remote artifact config surface:
  - `deploy.microFrontend.attestation` -> emitted as `process.env.MODERN_MF_REMOTE_ENTRY_ATTESTATION`
- Extended trust violation taxonomy:
  - `origin_isolation_violation`
  - `attestation_missing`
  - `attestation_mismatch`
- Extended fallback telemetry taxonomy mapping:
  - `origin_isolation_violation`
  - `attestation_missing`
  - `attestation_mismatch`

## 12. MF Cache Strategy Notes (2026-02-22)

- Added runtime remote-entry version pinning (`mfv` query) based on strongest available remote version signal:
  1. app-level `runtimeDigest`
  2. app-level `runtimeMetadata.runtimeDigest`
  3. app-level `integrity`
  4. app-level `runtimeMetadata.integrity`
  5. manifest-level `runtimeDigest`
  6. injected `window.modern_manifest.runtimeDigest`
- Added prod-server cache header policy for MF artifacts:
  - `/mf-manifest.json` and `/mf-stats.json`:
    - `Cache-Control: no-cache, no-store, must-revalidate`
    - `Pragma: no-cache`
    - `Expires: 0`
  - `remoteEntry*.js` without version pin:
    - `Cache-Control: public, max-age=0, must-revalidate`
  - `remoteEntry*.js` with version pin (`mfv` / `v` / `version` query):
    - `Cache-Control: public, max-age=31536000, immutable`
- Outcome:
  - latest manifests are always revalidated
  - version-pinned remote entries can be cached aggressively
  - rollback/freshness behavior is deterministic across independently deployed remotes.
