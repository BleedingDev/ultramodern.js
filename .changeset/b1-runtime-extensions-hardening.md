---
'@modern-js/server-runtime-extensions': minor
'@modern-js/prod-server': patch
---

Harden and repair the fork server runtime extensions:

- **Security (breaking for canary users):** the runtime-fallback-signal
  endpoint (`POST /_modern/contract-gates/runtime-fallback`) is now opt-in
  (`runtimeFallbackSignal.enabled` defaults to `false`) and refuses to start
  without a configured auth token (`auth.expectedValue` or
  `auth.expectedValueEnv`). Token comparison uses constant-time
  `crypto.timingSafeEqual`, and the rate limiter is keyed on the connection's
  remote address instead of attacker-controlled payload fields. The
  `GET /_modern/runtime/status` endpoint now returns a bare health probe by
  default and discloses telemetry/canary/trust detail only to authenticated
  callers. The `modern runtime status|fallback-signal` CLI commands keep
  working via their existing `--token`/`--token-env` flags.
- **SLO alerts:** `server.telemetry.slo` is now wired through
  `injectTelemetryPlugin()` to the telemetry registry with a logger alert
  sink, restoring pre-extraction behavior.
- **Telemetry shutdown:** the telemetry lane now flushes pending envelopes and
  stops canary/autopilot pollers when the node server closes (covering
  dev-server restarts) and on process `beforeExit`.
- **MF remote CSS:** the production remote-CSS collection is cached with a
  30s TTL (configurable via `injectModuleFederationCssPlugin({
  remoteCssCacheTtlMs })`) instead of being pinned forever at boot; failed
  collections are never cached (last-good list is served and the next request
  retries) and remote manifests are fetched in parallel.
- **MF cache headers:** new `injectMfAssetCacheHeadersPlugin()` (registered in
  the prod-server assembly) restores the documented ADR-0002 cache policy:
  `mf-manifest.json`/`mf-stats.json` are served `no-store` and
  `remoteEntry*.js` revalidates unless version-pinned (`?mfv=` → `immutable`).
- **Pluggable stateStores:** `stateStore.module` bare specifiers now resolve
  from the app directory (pnpm-strict compatible) instead of from the
  framework package.
