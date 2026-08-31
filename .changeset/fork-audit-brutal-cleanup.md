---
'@modern-js/builder': patch
'@modern-js/render': patch
'@modern-js/ultramodern-create': patch
'@modern-js/types': patch
'@modern-js/prod-server': patch
'@modern-js/server-runtime-extensions': patch
'@modern-js/runtime': patch
'@modern-js/server-core': patch
'@modern-js/app-tools': patch
'@modern-js/runtime-utils': patch
'@modern-js/utils': patch
---

Fork audit cleanup (fork-audit-2026-06-12):

- Removed dead packages: the rewritten `@modern-js/plugin-garfish` compat lane (MF is the sole micro-frontend runtime surface), and the private, unpublished `@modern-js/plugin-koa` / `@modern-js/plugin-express` v2 BFF adapters (the v3 BFF pipeline is hono/effect-only).
- prod-server: removed the zombie legacy server harness and the runtime-fallback worker lane (`src/server/*`, `src/libs/runtimeFallbackWorkerLane.ts`, `workerLane` config surface); MF cache headers and telemetry live in `@modern-js/server-runtime-extensions`.
- builder: fixed double-application of user PostCSS plugins — `@rsbuild/core` already loads the user postcss config, so the fork's second `postcss-load-config` pass was removed (workspace-root plugin resolution kept).
- render: fixed the edge-RSC artifact — `./rsc-worker` is now externalized in the rslib config so edge SSR bundles no longer bake in a MODULE_NOT_FOUND stub.
- create: fixed the generated vertical remote page template content.
- types: removed the dangling fork-added `moduleSdk` re-export and `common/moduleSdk.d.ts`.
- runtime/app-tools/server-core/runtime-utils/utils: deleted orphaned fork-added files (legacy `src/ssr` copies, worker async-storage shim, deploy `microFrontend` trust-contract fields, runtime-exports rewrite) restoring upstream shape.
