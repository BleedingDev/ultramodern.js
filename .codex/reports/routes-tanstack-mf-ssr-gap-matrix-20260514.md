# routes-tanstack-mf TanStack MF SSR Gap Matrix

Issue: `modernjs-6o2`
Plan todo: `untms-01`
Fixture: `tests/integration/routes-tanstack-mf`

## Executable Matrix

The executable form of this matrix lives in `tests/integration/routes-tanstack-mf/tests/tanstack-mf-contract.test.ts` under `executable SSR gap matrix records current MF route contract`.

| Area | Current proof | Status | Downstream requirement |
| --- | --- | --- | --- |
| Federated content during SSR | `mf-host/src/routes/mf/page.tsx` renders `remote-ssr-placeholder` / `remote-mutator-ssr-placeholder` when `typeof window === 'undefined'`; `remoteLoader.tsx` uses `React.lazy(loadRemote(...))` for the browser path. | Gap | Decide whether placeholders are the intended NoSSR boundary or implement a server-side Module Federation remote render/load path for `remote/Widget`, `remote/Mutator`, and `remote2/Panel`. |
| TanStack dehydrate / hydration bootstrap | `packages/runtime/plugin-runtime/src/router/runtime/tanstack/plugin.node.tsx` attaches TanStack server SSR utils, calls `serverSsr.dehydrate()`, captures buffered scripts, and stores `tanstackSsrScript`; `core/server/string/ssrData.ts` injects that hydration script; client runtime switches to `RouterClient` when `window.$_TSR` exists. | Covered runtime surface | Add an end-to-end assertion that served `/mf` includes TanStack bootstrap data once fixture SSR is enabled strongly enough to render route HTML. |
| Loader handoff | Generated `mf-host/src/modern-tanstack/index/router.gen.ts` wraps `mf/page.data.ts` loader with `modernLoaderToTanstack`, propagates `Request`, params, and request context, and stores `modernRouteLoader` in `staticData`. Browser fixture verifies loader data after hydration. | Covered | Keep this as the baseline while adding remote SSR. |
| Action handoff | `mf-host/src/routes/mf/page.data.ts` exports `action`; `tanstack/dataMutation.tsx` resolves `modernRouteAction`; generated `router.gen.ts` imports `action_1` and emits `modernRouteAction: action_1`. | Covered generated bridge | Keep this covered while the dedicated action bridge worker owns runtime/generator changes. |
| Remote fallback | `remoteLoader.tsx` exposes typed timeout/load/contract errors and `RemoteErrorBoundary`; integration tests already inject timeout/network/contract failures through query params. | Covered | Preserve deterministic fallback behavior when server-side remote SSR support is added. |
| Version skew | Host marks `@modern-js/runtime` as a singleton shared dependency, and host plus both remotes mark `@tanstack/react-router` as singleton shared dependencies with manifest `requiredVersion` values. | Covered manifest contract | Add a negative fixture or synthetic manifest check if runtime should reject incompatible remote versions instead of relying only on shared singleton negotiation. |

## Runtime Hotspots

- `packages/runtime/plugin-runtime/src/router/cli/code/tanstackTypes.ts`: generated TanStack route code now models loader and action static data; owned by the action bridge worker for further runtime/generator edits.
- `packages/runtime/plugin-runtime/src/router/runtime/tanstack/dataMutation.tsx`: client data mutations already look for `modernRouteAction`; this is the consumer surface the generator should feed.
- `packages/runtime/plugin-runtime/src/router/runtime/tanstack/plugin.node.tsx`: server-side TanStack lifecycle, `serverSsr.dehydrate()`, matched route snapshot, and hydration script capture.
- `packages/runtime/plugin-runtime/src/router/runtime/tanstack/plugin.tsx`: client hydration branch that selects `RouterClient` when TanStack SSR bootstrap exists.
- `packages/runtime/plugin-runtime/src/core/server/string/ssrData.ts`: injects Modern SSR data, router data, and TanStack hydration script into HTML.
- `packages/server/core/src/plugins/render/render.ts` and `packages/server/core/src/plugins/render/ssrRender.ts`: downstream server render/fallback path to inspect if route HTML remains a template placeholder under production serve.
