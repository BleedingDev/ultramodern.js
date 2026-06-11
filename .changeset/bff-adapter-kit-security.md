---
'@modern-js/bff-core': minor
'@modern-js/plugin-express': minor
'@modern-js/plugin-koa': minor
---

Add a typed adapter kit for BFF server adapters: `resolveCrossProjectPolicy` normalizes the user-facing cross-project policy config into evaluator input, `checkCrossProjectPolicy` maps violations onto the shared HTTP denial shape, and `planApiRoutes`/`getApiHandlerMode`/`mapSchemaHandlerResult`/`getResponseMetaList`/`buildPositionalHandlerArgs` centralize the framework-agnostic route registration and handler dispatch logic previously duplicated (with `any` casts) in the express and koa adapters. The shared adapter parity scenario table (handler modes, every cross-project policy rejection class including wrong-shape JSON envelopes, and pinned per-adapter drift) ships on a dedicated `@modern-js/bff-core/adapter-parity` subpath so the production entrypoint carries no test fixtures. bff-core also exposes `modern:source` so workspace tests resolve sources directly.

Behavior fixes in the adapters:

- `@modern-js/plugin-express`: a plain handler returning `undefined` now ends the response (200, empty body) instead of leaving the request open until the client times out. Both adapters previously imported `compatRequire`, which no longer exists in `@modern-js/utils` and crashed framework mode on first use; they now use a local interop require.
- `@modern-js/plugin-koa`: declares its real `type-is` and `reflect-metadata` dependencies (previously undeclared imports that only resolved through hoisting luck); unsupported HTTP methods fail registration with a descriptive error.
- Both adapters migrated off the legacy setup-object server-plugin API onto the tap-style `ServerPlugin` API: `setup` now registers `api.prepareApiServer`/`api.prepareWebServer` taps and reads context through `api.getServerContext()`/`api.getServerConfig()` instead of the compat registry's `useAppContext()`/`useConfigContext()`. Hook behavior (node-style `(req, res)` API handler, framework/function modes, cross-project policy enforcement, `enableHandleWeb` render pass-through, `server.enableFrameworkExt` web server) is unchanged and pinned by the shared adapter parity suite. With the legacy surface gone, the whole `src/` tree of both adapters is now gated by their `tsconfig.tsgo.json` entries in `scripts/tsgo-critical.txt` (previously `src/plugin.ts` was excluded).
