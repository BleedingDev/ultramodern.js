---
name: ultramodern-tanstack-fast-defaults-02-search-contracts
overview: Add first-class route search contracts to UltraModern's TanStack route generation so applications get typed, validated, structurally stable search state through TanStack primitives instead of hand-rolled URLSearchParams parsing.
todos:
  - id: trace-route-module-search-surface
    content: Trace the Modern route generation pipeline to identify where route module exports or route config metadata can carry `validateSearch`, `loaderDeps`, and related TanStack search options into `NestedRouteForCli`, `PageRoute`, and `RouteObject` without generated-file edits.
    status: pending
  - id: extend-route-type-contracts
    content: Extend the relevant Modern route metadata/types so TanStack route records can represent `validateSearch` and optional `loaderDeps` while React Router compatibility paths ignore unsupported TanStack-only fields safely.
    status: pending
  - id: pass-search-options-to-route-tree
    content: Update `packages/runtime/plugin-tanstack/src/runtime/routeTree.ts` so root, Modern generated routes, and RouteObject routes pass validated search options into `createRootRoute`/`createRoute` along with existing loader, staticData, SSR, and shouldReload options.
    status: pending
  - id: emit-search-options-in-router-gen
    content: Update `packages/runtime/plugin-tanstack/src/cli/tanstackTypes.ts` so generated `router.gen.ts` imports and emits route-level search validators/deps, keeping route variable names, register augmentation, and loader/action imports stable.
    status: pending
  - id: scaffold-search-example
    content: Add a small generated UltraModern route example that uses a validated search schema and `useSearch({ from, select })` or route-bound `useSearch` so new apps copy the fast path by default.
    status: pending
  - id: add-search-contract-tests
    content: Add tests proving validated search defaults are typed, inherited where appropriate, structurally stable across unrelated search changes, and preserved through SSR hydration and generated register typing.
    status: pending
isProject: false
---

# TanStack Fast Defaults: Search Contracts

## Execution Notes

The article's key router lesson is not merely "use TanStack Router"; it is "make the URL state shape stable so route consumers do not recreate objects on every navigation." React Router's documented `useSearchParams` returns `URLSearchParams`; TanStack Router's documented path is schema validation plus typed `useSearch` with selectors and optional structural sharing.

Local evidence:

- `packages/runtime/plugin-tanstack/src/runtime/routeTree.ts:733` and `:825` build TanStack route options with components, loader, `staticData`, SSR flags, and `shouldReload`, but no `validateSearch`.
- Root route creation in `packages/runtime/plugin-tanstack/src/runtime/routeTree.ts:909` and `:978` also lacks `validateSearch`.
- `packages/runtime/plugin-tanstack/src/cli/tanstackTypes.ts:284` emits each route from path/loader/staticData only, and `:539` emits root route options without search validation.
- Existing tests cover params, splats, loader metadata, lazy preload, deferred data, handles, and SSR flags in `packages/runtime/plugin-tanstack/tests/router/routeTree.test.ts`, so search contracts should be added beside those assertions.

External evidence:

- https://tanstack.com/router/latest/docs/how-to/setup-basic-search-params
- https://tanstack.com/router/latest/docs/api/router/RouteApiType
- https://tanstack.com/router/latest/docs/guide/render-optimizations
- https://reactrouter.com/api/hooks/useSearchParams

## Constraints

- Do not patch generated `router.gen.ts` in app fixtures directly. Change the generator and assert regenerated output.
- Do not force app authors into a specific validation library globally. Support schema-compatible validators and manual validators; generated examples can use the repo's existing dependency policy if a schema library is already present.
- Keep React Router compatibility intact. TanStack-only route metadata must not leak into `@modern-js/runtime/router` expectations.
- Search values used with structural sharing must stay JSON-compatible.

## Operator Guidance

Start by tracing the route module metadata source before editing `routeTree.ts`; otherwise it is easy to add an option that never reaches runtime. The highest-value tests are generated output tests in `packages/runtime/plugin-tanstack/tests/router/tanstackTypes.test.ts`, route behavior tests in `routeTree.test.ts`, and one integration type-test in `tests/integration/routes-tanstack/src/type-tests`.
