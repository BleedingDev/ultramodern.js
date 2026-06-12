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

The environment variables consumed by this package at runtime are parsed in a
single typed pass by `parseServerRuntimeExtensionsEnv()` in `src/env.ts`:

| Variable | Default | Description |
| --- | --- | --- |
| `MODERN_ENV` | _unset_ | Deployment environment name (also drives `.env.{MODERN_ENV}` loading in the server bootstrap). First candidate for the telemetry `environment` label. |
| `NODE_ENV` | _unset_ | Standard Node.js environment name. Second candidate for the telemetry `environment` label; the final fallback is `development`. |
| `MODERN_CONTRACT_GATES_FILE` | `.modern/contract-gates.json` (resolved against the app directory) | Path of the contract-gate snapshot file used by the canary autopilot and the runtime fallback signal endpoint when `server.telemetry.canary.autopilot.gateSnapshotPath` is not configured. |

Exporter endpoints and the module federation remote manifest timeout are
configured through `server.telemetry.exporters.*.endpoint` and plugin options
only; their defaults (`http://127.0.0.1:4318/v1/logs`,
`http://127.0.0.1:8428/api/v1/import/prometheus`, `1500`ms) are hard-coded,
matching the pre-extraction server-core behavior.
`MODERN_TELEMETRY_OTLP_ENDPOINT` / `MODERN_TELEMETRY_VICTORIA_ENDPOINT` are
read only at config time by `@modern-js/app-tools` (`baseline.ts`), not at
server runtime.

One dynamic indirection cannot be statically parsed:
`server.telemetry.canary.autopilot.runtimeFallbackSignal.auth.expectedValueEnv`
names an arbitrary environment variable that holds the expected runtime-signal
auth token; it is read when the auth config is normalized.
