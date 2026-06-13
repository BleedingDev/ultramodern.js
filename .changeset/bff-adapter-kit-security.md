---
'@modern-js/bff-core': minor
---

Add a typed adapter kit for BFF server adapters: `resolveCrossProjectPolicy` normalizes the user-facing cross-project policy config into evaluator input, `checkCrossProjectPolicy` maps violations onto the shared HTTP denial shape, and `planApiRoutes`/`getApiHandlerMode`/`mapSchemaHandlerResult`/`getResponseMetaList`/`buildPositionalHandlerArgs` centralize the framework-agnostic route registration and handler dispatch logic previously duplicated (with `any` casts) in the express and koa adapters. The shared adapter parity scenario table (handler modes, every cross-project policy rejection class including wrong-shape JSON envelopes, and pinned per-adapter drift) now lives as internal test support so the production entrypoint carries no test fixtures or public parity subpath. bff-core also exposes `modern:source` so workspace tests resolve sources directly.

(The private express and koa adapter packages that originally consumed this kit were removed from the fork — the v3 BFF pipeline is hono/effect-only.)
