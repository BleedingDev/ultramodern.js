---
'@modern-js/server-runtime-extensions': minor
'@modern-js/server-core': minor
'@modern-js/prod-server': patch
'@modern-js/create-request': patch
---

Extract the fork-owned server plugins (telemetry pipeline, contract-gate canary autopilot, module federation CSS collection and MF cache-header helpers) out of @modern-js/server-core into the new @modern-js/server-runtime-extensions package. The bare server-core default plugin chain no longer injects telemetry; @modern-js/prod-server registers `injectTelemetryPlugin()` and `injectModuleFederationCssPlugin()` in its plugin assembly, which is shared by the dev server, so production and dev behavior is unchanged for configured apps. Runtime environment behavior is unchanged: exporter endpoint and MF manifest timeout defaults stay hard-coded, and the env vars these plugins read at runtime (`MODERN_ENV`, `NODE_ENV`, `MODERN_CONTRACT_GATES_FILE`) are now parsed in a single typed pass (`parseServerRuntimeExtensionsEnv`). Telemetry traceparent parsing reuses the W3C-strict parser from @modern-js/create-request (all-zero trace/span ids are now rejected), and @modern-js/create-request gains a `require` condition on its `./server` export so CJS consumers load the CJS build instead of hitting `require(ESM)`.

BREAKING CHANGE (@modern-js/server-core): the fork-added telemetry/contract-gate public exports moved to @modern-js/server-runtime-extensions. Update imports as follows:

| Removed from @modern-js/server-core | New home |
| --- | --- |
| `injectTelemetryPlugin`, `TelemetryRegistry`, `TelemetryRegistryOptions`, `TelemetryEnvelope`, `TelemetryExporter`, `TelemetrySignalType`, `TelemetryQueueStats`, `TelemetrySloAlert`, `TelemetryStartupHealthError` | `@modern-js/server-runtime-extensions` |
| `createOtlpTelemetryExporter`, `createVictoriaMetricsTelemetryExporter`, `OtlpExporterOptions`, `VictoriaMetricsExporterOptions`, `hasEnabledTelemetryExporters`, `createTelemetryAwareMetrics` | `@modern-js/server-runtime-extensions` |
| `TelemetryCanaryOrchestrator`, `TelemetryCanaryDecision`, `TelemetryCanaryStatusSnapshot`, `ContractGateAutopilot`, `ContractGateAutopilotOptions` | `@modern-js/server-runtime-extensions` |
| `CONTRACT_GATE_SNAPSHOT_SCHEMA_VERSION`, `DEFAULT_CONTRACT_GATE_SNAPSHOT_PATH`, `createFileContractGateSnapshotStore`, `createHttpContractGateSnapshotStore`, `resolveContractGateSnapshotPath`, `resolveContractGateSnapshotStore`, `GateSnapshot`, `GateSnapshotGateValue`, `ContractGateSnapshotStore`, `ContractGateSnapshotHttpStoreOptions`, `ContractGateSnapshotStoreFactory`, `ContractGateSnapshotStoreFactoryContext`, `ContractGateSnapshotStoreModule`, `ContractGateSnapshotStoreUserConfig` | `@modern-js/server-runtime-extensions` |
| `createRuntimeFallbackSignalRuntimeState`, `createRuntimeSignalError`, `getRuntimeSignalErrorStatusCode`, `enforceRuntimeFallbackSignalAuthToken`, `enforceRuntimeFallbackSignalTrustPolicy`, `normalizeRuntimeFallbackSignalAuthConfig`, `normalizeRuntimeFallbackTrustPolicy`, `parseRuntimeFallbackSignalPayloadFromRawBody`, `resolveRuntimeFallbackSignalEndpoint`, `DEFAULT_RUNTIME_FALLBACK_SIGNAL_ENDPOINT`, `DEFAULT_RUNTIME_STATUS_ENDPOINT`, `RuntimeFallbackSignalAuthConfig`, `RuntimeFallbackSignalRuntimeState`, `RuntimeFallbackSignalTrustContext`, `RuntimeFallbackSignalTrustPolicy`, `RuntimeSignalError`, `RuntimeSignalErrorCode` | `@modern-js/server-runtime-extensions` |

@modern-js/prod-server also drops the unreachable fork-only legacy renderer (`src/server/modernServer.ts`, `src/libs/render/`), which was never importable (it referenced modules that do not exist) and was excluded from typechecking; its public API (`createProdServer`, `applyPlugins`, `./netlify`) is unchanged, and the remaining legacy runtime-signal harness (`src/server/index.ts`) is now part of the typechecked sources.
