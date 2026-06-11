---
'@modern-js/runtime': patch
'@modern-js/plugin-tanstack': patch
'@modern-js/plugin-i18n': patch
---

Consolidate all TanStack router code into `@modern-js/plugin-tanstack` and decontaminate the runtime context.

- `@modern-js/runtime` no longer ships a private copy of the TanStack runtime (`src/router/runtime/tanstack/` and the CLI `tanstackTypes` codegen are removed). `runtime.router.framework` is now resolved through a router-provider registry (`registerRouterProvider`/`resolveRouterProvider`, exported from `@modern-js/runtime/context` and `@modern-js/runtime/router/internal`): react-router registers itself as the default, `@modern-js/plugin-tanstack/runtime` registers the `tanstack` provider on import, and an unknown or unregistered framework now fails loudly with instructions to install `@modern-js/plugin-tanstack`.
- The fork-added context fields (`routerFramework`, `routerRuntime`, `routerInstance`, `routerHydrationScript`, `routerMatchedRouteIds`, `routerServerSnapshot`, `_helmetContext`) are removed from `TRuntimeContext`/`TInternalRuntimeContext`. Router and helmet state now live in a single symbol-keyed runtime-context extension slot (`createRuntimeContextExtension`), with typed accessors (`getRouterRuntimeState`/`getRouterServerSnapshot`) shared by all router providers and the SSR pipeline.
- `@modern-js/runtime/tanstack-router` remains published but is now a deprecated alias of `@tanstack/react-router` only; the Modern.js specific `Link`/`NavLink`/`Outlet`/`Form`/`useFetcher` bindings live exclusively in `@modern-js/plugin-tanstack/runtime`.
- `@modern-js/plugin-tanstack` reuses the canonical router runtime-state helpers and the `makeLegalIdentifier`/`getPathWithoutExt` codegen helpers from `@modern-js/runtime` instead of inlining copies, exposes a typed `getTanstackRouterState(context)` accessor, and the blocking hooks are registered solely under the `@modern-js/plugin-tanstack:*` namespace.
- `@modern-js/plugin-i18n` reads the router framework/instance through the public `getRouterRuntimeState` accessor instead of duck-typing private context fields; the react-router fallback behavior is unchanged.
