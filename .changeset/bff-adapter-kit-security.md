---
'@modern-js/bff-core': patch
---

Add a typed adapter kit for BFF server adapters: `resolveCrossProjectPolicy` normalizes the user-facing cross-project policy config into evaluator input, `checkCrossProjectPolicy` maps violations onto the shared HTTP denial shape, and `planApiRoutes`/`getApiHandlerMode`/`mapSchemaHandlerResult`/`getResponseMetaList`/`buildPositionalHandlerArgs` centralize the framework-agnostic route registration and handler dispatch logic previously duplicated (with `any` casts) in the express and koa adapters. Also ships a shared adapter parity scenario table covering handler modes and every cross-project policy rejection class, and exposes `modern:source` so workspace tests resolve sources directly.
