# TPCORE-01 Runtime Core TanStack Audit

Graph: `tanstack-plugin-first-class-ssr`
Plan: `tanstack-plugin-core-hooks.plan.md`
Todo: `tpcore-01`

## Scope

This is a read-only audit of current TanStack-specific code embedded in `@modern-js/runtime`. The goal is to classify every inspected surface as:

- `generic hook`: should remain in runtime core as router-agnostic extension/state infrastructure.
- `plugin-owned implementation`: should move to `@modern-js/plugin-tanstack`.
- `compatibility shim`: should remain only as a short-lived compatibility bridge or deprecation wrapper.
- `removable fixture/test code`: should move with plugin tests or be deleted after plugin extraction.

## Classification

| File / symbol | Classification | Rationale | Proposed destination / action |
| --- | --- | --- | --- |
| `packages/runtime/plugin-runtime/package.json` export `./tanstack-router` | Compatibility shim | Public API currently exposes TanStack APIs from `@modern-js/runtime/tanstack-router`. PR #8317 direction wants TanStack owned by a separate plugin, but existing apps/tests import this subpath. | Move real implementation to `@modern-js/plugin-tanstack/runtime`; keep `@modern-js/runtime/tanstack-router` as a temporary re-export with deprecation docs, then remove in a major version. |
| `packages/runtime/plugin-runtime/package.json` dependency `@tanstack/react-router` | Plugin-owned implementation | Pulls TanStack into runtime core dependency graph, which conflicts with clean plugin ownership. | Move to `@modern-js/plugin-tanstack` dependency/peer dependency. Runtime core should not depend on TanStack packages. |
| `packages/runtime/plugin-runtime/package.json` devDependency `@tanstack/history` | Removable fixture/test code | Used by runtime-core TanStack tests. Once tests move, core no longer needs it. | Move to plugin test/dev dependencies or remove from runtime core. |
| `src/exports/tanstack-router.ts` | Compatibility shim | It is a public facade that re-exports TanStack Router plus Modern `Form`, `useFetcher`, and prefetch links. Its contents are plugin-specific, but the path is already public. | Re-export from `@modern-js/plugin-tanstack/runtime` during compatibility window. New apps should import from plugin-owned runtime entry. |
| `src/router/runtime/internal.ts` `framework === 'tanstack' ? tanstackRouterPlugin : reactRouterPlugin` | Compatibility shim | Core router dispatcher embeds TanStack selection. It blocks clean plugin registration because core imports the TanStack implementation directly. | Replace with generic router provider registration hook, e.g. `registerRouterFramework({ name, clientPlugin, serverPlugin, cliGenerator })`. Keep `framework: 'tanstack'` mapped to plugin only while compatibility is enabled. |
| `src/router/runtime/types.ts` `RouterConfig.framework?: 'react-router' \| 'tanstack'` | Compatibility shim | The literal union hard-codes TanStack in core config types. Core needs a generic extension point, but existing configs rely on this value. | Introduce extensible `RouterFramework` registration/type augmentation. Keep `'tanstack'` compatibility value until plugin migration is complete. |
| `src/router/runtime/hooks.ts` router lifecycle hooks | Generic hook | Existing `modifyRoutes`, `onBeforeCreateRoutes`, `onBeforeCreateRouter`, `onAfterCreateRouter`, `onBeforeHydrateRouter`, and `onAfterHydrateRouter` are router-agnostic enough for React Router and TanStack. | Keep in runtime core. Extend only if plugin extraction exposes missing SSR/server-data seams. |
| `src/router/runtime/lifecycle.ts` `RouterLifecycleContext`, `applyRouterRuntimeState` | Generic hook | Core already models router framework, instance, hydration script, matched route ids, and server snapshot generically. This is the right shared state channel for plugin-owned routers. | Keep in runtime core. Consider broadening `RouterLifecyclePhase` and `InternalRouterServerSnapshot` rather than adding TanStack fields. |
| `src/core/context/runtime.ts` generic fields `routerFramework`, `routerRuntime`, `routerInstance`, `routerHydrationScript`, `routerMatchedRouteIds`, `routerServerSnapshot` | Generic hook | These fields provide framework-neutral state for SSR, hydration, status, errors, CSS assets, and router instance sharing. | Keep in runtime core as the canonical plugin/core contract. |
| `src/core/context/runtime.ts` TanStack fields `tanstackRouter`, `tanstackSsrScript`, `tanstackMatchedModernRouteIds` | Compatibility shim | These duplicate generic fields and leak TanStack types into runtime core via `AnyRouter`. | Replace usages with generic fields. If needed, expose plugin-specific state through `routerRuntime.instance` or plugin-owned context augmentation. Remove TanStack import from core. |
| `src/core/react/wrapper.tsx` preservation of generic router fields in `InternalRuntimeContext` | Generic hook | The wrapper intentionally keeps internal router state out of public `RuntimeContext` while preserving it for internal/plugin users. | Keep in runtime core. No TanStack-specific action needed once plugin fields are generic. |
| `src/core/server/string/ssrData.ts` `routerServerSnapshot?.hydrationScript ?? tanstackSsrScript` | Generic hook plus compatibility shim | Injecting a router-provided hydration script is generic; fallback to `tanstackSsrScript` is compatibility leakage. | Keep generic `routerServerSnapshot.hydrationScript`. Remove TanStack fallback after plugin uses generic state. |
| `src/core/server/stream/afterTemplate.ts` `routerServerSnapshot?.hydrationScript ?? tanstackSsrScript` | Generic hook plus compatibility shim | Same as string SSR: generic script injection is correct, TanStack fallback is legacy leakage. | Keep generic script hook; remove TanStack fallback when plugin writes generic runtime state. |
| `src/core/server/stream/beforeTemplate.ts` `routerServerSnapshot?.matchedRouteIds || tanstackMatchedModernRouteIds` | Generic hook plus compatibility shim | CSS injection by matched route ids is generic; TanStack-specific fallback duplicates `routerMatchedRouteIds`. | Keep matched-route-id support through generic snapshot/runtime fields. Remove TanStack fallback. |
| `src/core/server/requestHandler.tsx` `routerServerSnapshot` status/error handling | Generic hook | Server status/error propagation from router plugins is framework-neutral. | Keep in runtime core and document as SSR router plugin contract. |
| `src/ssr/serverRender/renderToString/entry.ts` `routerServerSnapshot.routerData` | Generic hook | String SSR can serialize router data from a generic snapshot without knowing which router produced it. | Keep in runtime core. Plugin decides whether it supplies `routerData`, `hydrationScript`, or both. |
| `src/router/runtime/tanstack/plugin.tsx` | Plugin-owned implementation | Client TanStack integration owns route-tree conversion, TanStack history creation, `RouterClient`, `RouterProvider`, basepath rewrite, SSR bootstrap detection, and TanStack lifecycle calls. | Move to `@modern-js/plugin-tanstack/runtime/client`. Register through core runtime plugin API and generic router framework registry. |
| `src/router/runtime/tanstack/plugin.node.tsx` | Plugin-owned implementation | Server TanStack SSR owns memory history, request context adaptation, route tree creation, `attachRouterServerSsrUtils`, `router.load()`, redirects, dehydration, hydration scripts, status/errors, and server render wrapper. | Move to `@modern-js/plugin-tanstack/runtime/server`. It should write only generic `routerServerSnapshot`/`routerRuntime` fields. |
| `src/router/runtime/tanstack/routeTree.ts` | Plugin-owned implementation | Converts Modern route objects and file route metadata into TanStack route trees, maps params, wraps loaders/actions, maps redirects/notFound, and computes Modern route ids. This is TanStack-specific. | Move to plugin runtime internals. Consider sharing only a tiny generic `ModernRouteObject` input type from core. |
| `src/router/runtime/tanstack/dataMutation.tsx` | Plugin-owned implementation | Implements TanStack-specific Modern `Form`/`useFetcher` compatibility on top of TanStack router staticData and route actions. | Move to plugin runtime public exports. Keep API stable via compatibility re-export if necessary. |
| `src/router/runtime/tanstack/prefetchLink.tsx` | Plugin-owned implementation | Wraps TanStack `Link` and maps Modern `prefetch` semantics to TanStack `preload`. | Move to plugin runtime public exports. |
| `src/router/runtime/tanstack/basepathRewrite.ts` | Plugin-owned implementation | Uses TanStack rewrite API shape and exists to compensate for TanStack basepath behavior. | Move to plugin runtime internals. |
| `src/router/runtime/tanstack/ssr-shim.d.ts` | Plugin-owned implementation | Type shim declares TanStack SSR client/server modules. This should live next to TanStack dependency ownership. | Move to plugin package, ideally replace with upstream types when available. |
| `src/router/cli/code/tanstackTypes.ts` | Plugin-owned implementation | Generates `src/modern-tanstack/**`, imports `@modern-js/runtime/tanstack-router`, maps Modern loader/action modules, emits TanStack route tree and register augmentation. This is plugin CLI ownership. | Move to `@modern-js/plugin-tanstack/cli`. Use core generate-code hooks for route metadata and file emission. Change generated imports to plugin-owned runtime entry. |
| `src/router/cli/code/index.ts` import/use of `tanstackTypes.ts` | Compatibility shim | Core route generation directly detects `framework: 'tanstack'` and emits TanStack files. The route discovery itself is generic, but the TanStack emission is not. | Add generic route-codegen hook(s): route discovery stays core, plugin receives normalized routes/entry metadata and emits plugin-owned files. Remove direct TanStack generator from core after plugin extraction. |
| `src/router/cli/code/index.ts` generated `modern-tanstack/register.gen.d.ts` module augmentation for `@modern-js/runtime/tanstack-router` | Plugin-owned implementation | Register augmentation is specific to TanStack typed router inference and current runtime subpath. | Move to plugin CLI. During compatibility, generate both plugin module augmentation and deprecated runtime subpath augmentation only if needed. |
| `isTanstackRouterFrameworkEnabled()` heuristic in `tanstackTypes.ts` | Compatibility shim | Reads app runtime config with regex to decide if core should emit TanStack files. Plugin architecture should not require runtime core to inspect plugin-specific config. | Replace with plugin-owned CLI registration/config detection. Core may expose generic entry/config metadata hooks. |
| `tests/router/tanstackTypes.test.ts` | Removable fixture/test code | Tests plugin-specific generator behavior in runtime core. | Move to `@modern-js/plugin-tanstack` tests. |
| `tests/router/tanstackRouteTree.test.ts` | Removable fixture/test code | Tests plugin-specific route-tree conversion. | Move to plugin runtime tests. |
| `tests/router/dataMutation.test.tsx` | Removable fixture/test code | Tests plugin-specific `Form`/`useFetcher` behavior. | Move to plugin runtime tests. |
| `tests/router/lifecycle.test.tsx` | Generic hook | Tests generic router runtime state and hook exposure, despite using `'tanstack'` as example data. | Keep in runtime core, but change fixture value to a generic/custom framework id once framework registration is extensible. |
| `tests/core/react/wrapper.test.tsx` TanStack-flavored context fixture | Generic hook | Verifies internal router fields are preserved across providers. The specific string `'tanstack'` is incidental. | Keep in runtime core, but remove TanStack naming from fixture after generic router state is established. |

## Generic Hooks Needed

The current code already has part of the right clean architecture. The missing piece is to stop hard-coding TanStack as a framework branch and make plugins register against these seams:

1. `routerFramework` registration: core should let a plugin register a router framework id and client/server runtime plugin factories without importing that framework implementation.
2. CLI route codegen hook: core should discover normalized route metadata once, then call plugin-owned generators with `{ entrypoint, routes, ssrMode, appContext, config }`.
3. File regeneration hook: plugin-owned generated files must participate in dev watcher invalidation without core knowing file names such as `modern-tanstack/router.gen.ts`.
4. SSR prepare hook: plugin needs a generic server hook to create/load its router before render, set status/errors/redirects, and return an `InternalRouterServerSnapshot`.
5. Hydration payload/script hook: core should inject `routerServerSnapshot.hydrationScript` generically, without framework-specific fallback fields.
6. Matched route asset hook: core should consume generic `routerServerSnapshot.matchedRouteIds` / `routerMatchedRouteIds` for CSS/assets, not `tanstackMatchedModernRouteIds`.
7. Router action/loader metadata contract: route generators need a generic way to attach plugin-owned static route metadata for loaders/actions, while core treats it as opaque.
8. Compatibility export hook: temporary bridge from `@modern-js/runtime/tanstack-router` to plugin runtime should be isolated and removable.

## Extraction Order

1. Generalize core state first by removing new TanStack-specific fields from future code paths and proving generic `routerRuntime` / `routerServerSnapshot` is sufficient.
2. Add a router-framework registry in runtime core so `@modern-js/runtime/router` no longer imports `./tanstack/plugin`.
3. Add CLI route-codegen and file-regeneration hooks so plugin generators can emit `modern-tanstack/**`.
4. Scaffold `@modern-js/plugin-tanstack` with moved runtime client/server code and generator tests.
5. Change generated imports from `@modern-js/runtime/tanstack-router` to plugin-owned runtime exports.
6. Keep runtime-core compatibility subpath as a thin re-export until downstream fixtures/docs move.
7. Move integration fixtures to install/use the plugin explicitly, then delete TanStack implementation/tests from runtime core.

## Search Commands Used

```bash
python3 /Users/satan/side/experiments/skills/subagent-graph/scripts/get_agent_limits.py
git status --short
python3 /Users/satan/side/experiments/skills/plan-graph/scripts/plan_graph.py frontier --plan .codex/plans/tanstack-plugin-core-hooks.plan.md --plan .codex/plans/tanstack-router-plugin-package.plan.md --plan .codex/plans/tanstack-plugin-ssr-mf-contract.plan.md --depends tanstack-plugin-core-hooks:tanstack-router-plugin-package --depends tanstack-router-plugin-package:tanstack-plugin-ssr-mf-contract --graph-id tanstack-plugin-first-class-ssr --write-state
rg --files packages/runtime/plugin-runtime | rg 'tanstack|router|runtime|cli|test'
sed -n '1,220p' packages/runtime/plugin-runtime/package.json
sed -n '220,360p' packages/runtime/plugin-runtime/package.json
sed -n '1,220p' packages/runtime/plugin-runtime/src/exports/tanstack-router.ts
find packages/runtime/plugin-runtime/src/router/runtime/tanstack -type f -maxdepth 1 -print | sort
rg -n "tanstack|TanStack|modernRouteAction|modernRouteLoader|RouterProvider|createRouter|dehydrate|hydrate|routeTree|useFetcher|Form|Prefetch" packages/runtime/plugin-runtime/src packages/runtime/plugin-runtime/tests/router
sed -n '1,280p' packages/runtime/plugin-runtime/src/router/runtime/tanstack/plugin.tsx
sed -n '1,340p' packages/runtime/plugin-runtime/src/router/runtime/tanstack/plugin.node.tsx
sed -n '1,260p' packages/runtime/plugin-runtime/src/router/runtime/lifecycle.ts
sed -n '1,180p' packages/runtime/plugin-runtime/src/core/context/runtime.ts
sed -n '1,220p' packages/runtime/plugin-runtime/src/router/runtime/internal.ts
sed -n '1,360p' packages/runtime/plugin-runtime/src/router/runtime/plugin.tsx
sed -n '1,330p' packages/runtime/plugin-runtime/src/router/runtime/plugin.node.tsx
sed -n '1,240p' packages/runtime/plugin-runtime/src/router/runtime/hooks.ts
sed -n '1,260p' packages/runtime/plugin-runtime/src/router/runtime/types.ts
sed -n '1,540p' packages/runtime/plugin-runtime/src/router/cli/code/tanstackTypes.ts
sed -n '1,430p' packages/runtime/plugin-runtime/src/router/cli/code/index.ts
sed -n '1,560p' packages/runtime/plugin-runtime/src/router/runtime/tanstack/dataMutation.tsx
sed -n '1,540p' packages/runtime/plugin-runtime/src/router/runtime/tanstack/routeTree.ts
sed -n '1,140p' packages/runtime/plugin-runtime/src/router/runtime/tanstack/prefetchLink.tsx
sed -n '1,140p' packages/runtime/plugin-runtime/src/router/runtime/tanstack/basepathRewrite.ts
sed -n '1,80p' packages/runtime/plugin-runtime/src/router/runtime/tanstack/ssr-shim.d.ts
rg -n "routerFramework|routerRuntime|routerInstance|routerHydrationScript|routerMatchedRouteIds|routerServerSnapshot|tanstackRouter|tanstackSsrScript|tanstackMatchedModernRouteIds|framework: 'tanstack'|framework === 'tanstack'|framework\\?: 'react-router' \\| 'tanstack'" packages/runtime/plugin-runtime/src packages/runtime/plugin-runtime/tests/router
sed -n '1,150p' packages/runtime/plugin-runtime/src/core/server/stream/beforeTemplate.ts
sed -n '90,150p' packages/runtime/plugin-runtime/src/core/server/stream/afterTemplate.ts
sed -n '70,130p' packages/runtime/plugin-runtime/src/core/server/string/ssrData.ts
sed -n '1,80p' packages/runtime/plugin-runtime/src/core/react/wrapper.tsx
sed -n '270,320p' packages/runtime/plugin-runtime/src/core/server/requestHandler.tsx
sed -n '1,140p' packages/runtime/plugin-runtime/tests/router/lifecycle.test.tsx
sed -n '1,140p' packages/runtime/plugin-runtime/tests/router/tanstackTypes.test.ts
sed -n '1,120p' packages/runtime/plugin-runtime/tests/router/tanstackRouteTree.test.ts
sed -n '1,120p' packages/runtime/plugin-runtime/tests/router/dataMutation.test.tsx
rg -n "@modern-js/runtime/tanstack-router|modern-tanstack|framework\\s*:\\s*['\\\"]tanstack|tanstack" packages tests --glob '!tests/integration/routes-tanstack-mf/**'
```

## Verification

No source or test files were modified for this audit. Verification is the read-only command trail above plus the report file itself.
