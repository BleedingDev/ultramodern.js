---
'@modern-js/server-runtime-extensions': minor
'@modern-js/server-core': patch
'@modern-js/prod-server': patch
---

Extract the fork-owned server plugins (telemetry pipeline, contract-gate canary autopilot, module federation CSS collection and MF cache-header helpers) out of @modern-js/server-core into the new @modern-js/server-runtime-extensions package. The bare server-core default plugin chain no longer injects telemetry; @modern-js/prod-server registers `injectTelemetryPlugin()` and `injectModuleFederationCssPlugin()` in its plugin assembly, which is shared by the dev server, so production and dev behavior is unchanged for configured apps. All environment variables consumed by these plugins are now parsed in a single typed pass (`parseServerRuntimeExtensionsEnv`), and telemetry traceparent parsing reuses the W3C-strict parser from @modern-js/create-request (all-zero trace/span ids are now rejected).
