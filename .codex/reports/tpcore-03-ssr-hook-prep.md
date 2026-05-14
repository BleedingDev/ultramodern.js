# TPCORE-03 SSR Hook Prep

Graph: `tanstack-plugin-first-class-ssr`
Plan: `tanstack-plugin-core-hooks.plan.md`
Todo: `tpcore-03`

## Scope

Read-only preparation for the generic SSR runtime seam needed by plugin-owned routers after `tpcore-02` lands. This report uses current `@modern-js/runtime` core runtime files and the embedded TanStack server runtime as implementation evidence. No source, fixture, or dirty integration files were changed.

During this read, `tpcore-02` appeared in progress in the worktree with CLI-only changes for route-dir metadata, built-in route entry filtering, keyed regeneration, and generated routes by entry. The SSR seam below assumes that direction holds and does not require further CLI-specific changes beyond consuming plugin-owned route output.

## Current Generic SSR State Surfaces To Keep

- `TInternalRuntimeContext.routerFramework`, `routerRuntime`, `routerInstance`, `routerHydrationScript`, `routerMatchedRouteIds`, and `routerServerSnapshot` in `packages/runtime/plugin-runtime/src/core/context/runtime.ts`.
- `InternalRouterRuntimeState` and `InternalRouterServerSnapshot` in `packages/runtime/plugin-runtime/src/router/runtime/types.ts`.
- `RouterLifecycleContext` plus `applyRouterRuntimeState()` / `createRouterRuntimeState()` in `packages/runtime/plugin-runtime/src/router/runtime/lifecycle.ts`.
- Existing lifecycle hooks in `packages/runtime/plugin-runtime/src/router/runtime/hooks.ts`: `onBeforeCreateRoutes`, `modifyRoutes`, `onBeforeCreateRouter`, `onAfterCreateRouter`, `onBeforeHydrateRouter`, and `onAfterHydrateRouter`.
- `routerServerSnapshot.statusCode` and `routerServerSnapshot.errors` handling in `packages/runtime/plugin-runtime/src/core/server/requestHandler.tsx`.
- `routerServerSnapshot.routerData` and `routerServerSnapshot.hydrationScript` consumption in `packages/runtime/plugin-runtime/src/core/server/string/ssrData.ts`.
- `routerServerSnapshot.hydrationScript` stream injection in `packages/runtime/plugin-runtime/src/core/server/stream/afterTemplate.ts`.
- `routerServerSnapshot.matchedRouteIds` CSS lookup in `packages/runtime/plugin-runtime/src/core/server/stream/beforeTemplate.ts`.
- `wrapRuntimeContextProvider()` preserving router state in `InternalRuntimeContext` while keeping router internals out of public `RuntimeContext`.
- React Router's server plugin pattern in `packages/runtime/plugin-runtime/src/router/runtime/plugin.node.tsx`: route creation, `onBeforeCreateRouter`, async load/query, generic snapshot creation, `applyRouterRuntimeState()`, and `onAfterCreateRouter`.

These surfaces are already router-agnostic enough. The main `tpcore-03` work should harden and type them rather than invent a parallel TanStack-specific channel.

## TanStack-Specific Fields And Fallbacks To Remove Or Shim

- Remove the core dependency on `@tanstack/react-router` from `packages/runtime/plugin-runtime/src/core/context/runtime.ts`; `AnyRouter` is only needed by the plugin-owned implementation.
- Remove or deprecate `TInternalRuntimeContext.tanstackRouter`, `tanstackSsrScript`, and `tanstackMatchedModernRouteIds`. They duplicate `routerInstance`, `routerServerSnapshot.hydrationScript`, and `routerServerSnapshot.matchedRouteIds`.
- Remove fallback reads of `runtimeContext.tanstackSsrScript` in `core/server/string/ssrData.ts` and `core/server/stream/afterTemplate.ts` once the TanStack runtime writes `routerServerSnapshot.hydrationScript`.
- Remove fallback reads of `runtimeContext.tanstackMatchedModernRouteIds` in `core/server/stream/beforeTemplate.ts` once the TanStack runtime writes `routerServerSnapshot.matchedRouteIds`.
- Change the embedded TanStack server runtime, while it still exists in core, to use only `applyRouterRuntimeState()` and `routerInstance` / `routerRuntime.instance` for server wrapper access. If compatibility requires `tanstackRouter`, keep it as a plugin-owned local augmentation or an `unknown` deprecated shim, not a core typed TanStack import.
- Treat `RouterConfig.framework?: 'react-router' | 'tanstack'` and the dispatcher in `router/runtime/internal.ts` as compatibility concerns. `tpcore-03` should avoid adding more framework literals; after `tpcore-02`, plugin registration should provide the framework id.

## Proposed Minimal Router-Agnostic API Shape

The minimal seam should be a typed server preparation contract plus small normalization helpers. Plugin routers can still use `api.onBeforeRender` for async work and `api.wrapRoot` for rendering; core only needs to know how to consume their result.

```ts
export type RouterFramework = 'react-router' | (string & {});

export interface RouterRouteMatchSnapshot {
  routeId: string;
  assetRouteId?: string;
  pathname?: string;
  params?: Record<string, string>;
}

export interface InternalRouterServerSnapshot {
  framework?: RouterFramework;
  basename?: string;
  statusCode?: number;
  errors?: Record<string, unknown>;
  routerData?: {
    loaderData?: Record<string, unknown>;
    errors?: Record<string, unknown>;
  };
  hydrationScript?: string;
  hydrationScripts?: string[];
  matchedRouteIds?: string[];
  matches?: RouterRouteMatchSnapshot[];
}

export interface InternalRouterRuntimeState {
  framework: RouterFramework;
  basename?: string;
  instance?: unknown;
  hydrationScript?: string;
  hydrationScripts?: string[];
  matchedRouteIds?: string[];
  matches?: RouterRouteMatchSnapshot[];
  serverSnapshot?: InternalRouterServerSnapshot;
  cleanup?: () => void | Promise<void>;
}

export interface RouterServerPrepareResult {
  state: InternalRouterRuntimeState;
  snapshot?: InternalRouterServerSnapshot;
  redirect?: Response;
  cleanup?: () => void | Promise<void>;
}
```

Recommended helper surface:

- `createRouterServerSnapshot(state)` should normalize `framework`, `basename`, `hydrationScript` from `hydrationScripts`, `matchedRouteIds` from `matches`, and carry status/errors/routerData.
- `applyRouterServerPrepareResult(runtimeContext, result)` should call `applyRouterRuntimeState()`, set `routerServerSnapshot`, expose `routerHydrationScript` / `routerMatchedRouteIds`, and register cleanup without knowing router internals.
- `getRouterHydrationScripts(runtimeContext)` should return generic scripts from `routerServerSnapshot.hydrationScripts`, `routerServerSnapshot.hydrationScript`, `routerRuntime.hydrationScripts`, or `routerHydrationScript`; templates should not know about TanStack.
- `getRouterMatchedRouteIds(runtimeContext)` should return `routerServerSnapshot.matchedRouteIds`, `routerRuntime.matchedRouteIds`, `routerMatchedRouteIds`, or `matches.map(m => m.assetRouteId ?? m.routeId)`.
- Redirects can keep using the existing `api.onBeforeRender` interrupt/`Response` path. If `RouterServerPrepareResult.redirect` is added, `requestHandler.tsx` should process it through the same existing redirect handling path.
- Cleanup should be invoked by the plugin around interrupt/redirect immediately and by core after server render if `cleanup` is registered. The current TanStack evidence is `(router as any).serverSsr?.cleanup?.()` before redirect.

TanStack maps cleanly to this shape:

- Server router creation: `createMemoryHistory`, `createRouteTreeFromRouteObjects()`, `createRouter()`, `attachRouterServerSsrUtils()`.
- Server load: `await tanstackRouter.load()`.
- Redirect: `(router as any).state.redirect`, resolved through `resolveRedirect()`, returned as a `Response`.
- Status/errors: `router.state.statusCode` and errors collected from `router.state.matches`.
- Dehydration/scripts: `await router.serverSsr.dehydrate()` and `takeBufferedScripts()` converted to HTML strings.
- Route match snapshot: `getModernRouteIdsFromMatches(router)` should become `matchedRouteIds` or `matches`.
- Cleanup: `router.serverSsr.cleanup()`.

## Exact Files Likely Touched In `tpcore-03`

- `packages/runtime/plugin-runtime/src/router/runtime/types.ts`: broaden `RouterFramework`, add route match snapshot/result/cleanup types, and normalize hydration script fields.
- `packages/runtime/plugin-runtime/src/router/runtime/lifecycle.ts`: add server-prepare normalization helpers and possibly extend `RouterLifecycleContext` with `matches`, `cleanup`, and normalized snapshot fields.
- `packages/runtime/plugin-runtime/src/router/runtime/hooks.ts`: likely unchanged unless `onBeforeLoadRouter` / `onAfterLoadRouter` is explicitly needed. Prefer existing `onBeforeCreateRouter` / `onAfterCreateRouter` plus typed prepare helpers.
- `packages/runtime/plugin-runtime/src/core/context/runtime.ts`: remove the TanStack type import and remove or downgrade `tanstack*` compatibility fields.
- `packages/runtime/plugin-runtime/src/core/react/wrapper.tsx`: preserve any new generic internal-only fields such as `routerCleanup` or `routerRuntime.cleanup`.
- `packages/runtime/plugin-runtime/src/core/server/string/ssrData.ts`: inject only generic router hydration scripts.
- `packages/runtime/plugin-runtime/src/core/server/stream/afterTemplate.ts`: inject only generic router hydration scripts.
- `packages/runtime/plugin-runtime/src/core/server/stream/beforeTemplate.ts`: resolve CSS route ids only from generic snapshot/runtime match state.
- `packages/runtime/plugin-runtime/src/core/server/requestHandler.tsx`: keep existing status/error handling; touch only if generic redirect or cleanup is centralized in core.
- `packages/runtime/plugin-runtime/src/router/runtime/plugin.node.tsx`: move built-in React Router snapshot creation onto the new helper so React Router proves the generic contract.
- `packages/runtime/plugin-runtime/src/router/runtime/tanstack/plugin.node.tsx`: while still embedded, replace `tanstack*` writes/reads with generic state. Later this file should move to `@modern-js/plugin-tanstack`.
- `packages/runtime/plugin-runtime/src/router/runtime/tanstack/plugin.tsx`: while still embedded, replace `runtimeState.tanstackRouter` with `routerInstance` / `routerRuntime.instance` or a plugin-local shim.
- `packages/runtime/plugin-runtime/src/router/runtime/internal.ts`: avoid expanding the current `framework === 'tanstack'` branch. A later extraction/registration slice should remove the direct import.

## Focused Tests Needed

- `tests/router/lifecycle.test.tsx`: use a custom framework id such as `custom-router` instead of `tanstack`; assert normalization fills `framework`, `basename`, `hydrationScript(s)`, `matchedRouteIds`, and `serverSnapshot`.
- `tests/core/react/wrapper.test.tsx`: verify new generic fields remain internal-only and public `RuntimeContext` only exposes safe public state.
- `tests/ssr/serverRender/renderToString/entry.test.ts`: assert `routerServerSnapshot.hydrationScript` and `hydrationScripts` both serialize, and no `tanstackSsrScript` fallback is required.
- `tests/ssr/serverRender/renderToStream/buildTemplate.after.test.ts`: assert stream SSR injects generic router hydration scripts only.
- `tests/ssr/serverRender/renderToStream/buildTemplate.before.test.ts`: assert CSS injection uses generic `matchedRouteIds` / `matches.assetRouteId` and does not require `tanstackMatchedModernRouteIds`.
- `tests/ssr/serverRender/requestHandler.test.tsx`: keep current generic status/error fallback; add a redirect case only if `RouterServerPrepareResult.redirect` is centralized in core.
- Add a small runtime-only fake router test plugin if practical: it should create an opaque router object, set generic snapshot data, emit a hydration script, matched route ids, status/errors, and cleanup, with no TanStack imports.

## Risks And Unresolved Questions

- `hydrationScript` is a raw HTML string today. That matches current TanStack output, but multiple router-managed tags are cleaner as `hydrationScripts: string[]`. Core should normalize both for compatibility.
- Cleanup ownership is ambiguous. Plugin-owned routers can clean up around redirects today, but core-level cleanup after successful SSR needs a clear lifecycle location to avoid leaking server SSR buffers.
- Redirect ownership should stay conservative. Existing `onBeforeRender` returning `Response` already works with `requestHandler.tsx`; adding `snapshot.redirect` may duplicate paths unless there is a concrete plugin need.
- `routerContext` remains React Router-specific fallback state. It can stay for built-in React Router compatibility, but new plugin routers should not depend on it.
- `matches` shape should remain asset-focused and not encode router-specific match objects. Core only needs route ids for CSS/assets; plugins can keep richer match objects in `routerRuntime.instance`.
- Until the embedded TanStack runtime moves out, tests may still import TanStack transitively. `tpcore-03` should prevent new core TanStack imports and remove the context-level import, but full dependency removal belongs to plugin extraction.

## Verification

Read-only evidence commands were run against the plan, prior audit, current runtime files, and focused tests. No source files, fixture files, commits, or pushes were made.
