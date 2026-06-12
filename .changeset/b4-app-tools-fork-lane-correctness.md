---
'@modern-js/app-tools': minor
---

Security and correctness fixes in the app-tools fork lane:

- The generated Cloudflare worker entry no longer applies wildcard CORS to
  BFF, SSR, and 404 responses. Static asset responses keep wildcard CORS for
  federated remote loading (disable via
  `deploy.worker.security.cors.assets: false`). Cross-origin access to
  application responses is now opt-in through
  `deploy.worker.security.cors.allowedOrigins` (plus `allowedMethods` /
  `allowedHeaders`, whose preflight defaults now cover the methods the BFF
  actually serves). The write-only `deploy.worker.security.cookies` option is
  deprecated and remains a typed no-op (the worker never consumed it); it
  will be removed once generated workspaces stop emitting it.
- `presetUltramodern` no longer force-enables RsDoctor for production builds
  (RsDoctor stays opt-in per the reverted ADR-0001) and no longer enables
  telemetry exporters pointing at localhost collectors by default. Exporters
  are now enabled per endpoint when explicitly configured via options or the
  `MODERN_TELEMETRY_*` environment variables, or all at once via
  `enableTelemetryExporters: true` — so a bare `presetUltramodern({})` app
  boots in production with fail-loud startup intact.
- The preset's react-router bridge aliases now pick the development build in
  dev mode and resolve react-router from the app directory (bundler context)
  instead of `process.cwd()`.
- `presetUltramodern` is the single public preset name;
  `withAppBaseline` / `createAppBaselineConfig` / `AppBaselineOptions` remain
  as deprecated aliases.
- `modern runtime status|fallback-signal` now prints a human-readable
  rendering by default; `--json` emits machine-readable JSON as documented.
- `resolveESMDependency` uses the spec-compliant `import-meta-resolve`
  resolver again instead of a partial hand-rolled package-exports parser,
  fixing silently-degraded ESM deploy entries for packages with root-sugar
  or nested conditional exports.
- Removed unused dependencies `@swc/core` and `esbuild-register`; fixed the
  stale `output.precompress` default documentation.
