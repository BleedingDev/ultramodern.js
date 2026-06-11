# @modern-js/server-runtime-extensions

Fork-owned ultramodern.js server runtime extensions. This package hosts the
server-side fork features that previously lived inside the upstream-owned
`@modern-js/server-core` sources, so the fork diff against upstream Modern.js
stays small:

- **Telemetry pipeline** — `TelemetryRegistry`, OTLP / VictoriaMetrics
  exporters, SLO alerts, telemetry-aware metrics wrapping and the
  `injectTelemetryPlugin()` server plugin (runtime status + runtime fallback
  signal endpoints).
- **Contract-gate canary autopilot** — `TelemetryCanaryOrchestrator`,
  `ContractGateAutopilot` and the file/HTTP contract-gate snapshot stores.
- **Module federation runtime helpers** — remote CSS collection for SSR
  (`collectDirectRemoteModuleFederationCss`, `injectModuleFederationCssPlugin()`)
  and MF asset cache-header policies (`resolveMfAssetCacheHeaders`).

## Registration

None of these plugins are part of the bare `@modern-js/server-core` default
plugin chain. `@modern-js/prod-server` registers them in its plugin assembly
(`applyPlugins`), which is also the assembly used by the dev server
(`@modern-js/server` via `@modern-js/app-tools`), so production and dev behave
identically:

- `injectTelemetryPlugin()` — no-op unless `server.telemetry` is configured.
- `injectModuleFederationCssPlugin()` — no-op unless the dist directory
  contains an `mf-manifest.json` host manifest. Must be registered after
  `injectResourcePlugin()` so the request-scoped server manifest exists.

## Environment variables

All environment variables consumed by this package are parsed in a single
typed pass by `parseServerRuntimeExtensionsEnv()` in `src/env.ts`:

| Variable | Default | Description |
| --- | --- | --- |
| `MODERN_ENV` | _unset_ | Deployment environment name (also drives `.env.{MODERN_ENV}` loading in the server bootstrap). First candidate for the telemetry `environment` label. |
| `NODE_ENV` | _unset_ | Standard Node.js environment name. Second candidate for the telemetry `environment` label; the final fallback is `development`. |
| `MODERN_CONTRACT_GATES_FILE` | `.modern/contract-gates.json` (resolved against the app directory) | Path of the contract-gate snapshot file used by the canary autopilot and the runtime fallback signal endpoint when `server.telemetry.canary.autopilot.gateSnapshotPath` is not configured. |
| `MODERN_TELEMETRY_OTLP_ENDPOINT` | `http://127.0.0.1:4318/v1/logs` | Default endpoint for the OTLP log-envelope exporter when `server.telemetry.exporters.otlp.endpoint` is not configured. |
| `MODERN_TELEMETRY_VICTORIA_ENDPOINT` | `http://127.0.0.1:8428/api/v1/import/prometheus` | Default endpoint for the VictoriaMetrics exporter when `server.telemetry.exporters.victoriaMetrics.endpoint` is not configured. |
| `MODERN_MF_REMOTE_MANIFEST_TIMEOUT_MS` | `1500` | Timeout in milliseconds for fetching remote module federation manifests during SSR CSS collection. Invalid or non-positive values fall back to the default. |

One dynamic indirection cannot be statically parsed:
`server.telemetry.canary.autopilot.runtimeFallbackSignal.auth.expectedValueEnv`
names an arbitrary environment variable that holds the expected runtime-signal
auth token; it is read when the auth config is normalized.

`MODERN_RUNTIME_FALLBACK_WORKER_LANE` is consumed by the
`@modern-js/prod-server` legacy harness (worker-lane gate persistence), not by
this package.
