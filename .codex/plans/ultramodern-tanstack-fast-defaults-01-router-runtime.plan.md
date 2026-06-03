---
name: ultramodern-tanstack-fast-defaults-01-router-runtime
overview: Make the Modern-owned TanStack Router runtime fast by default by enabling structural-sharing-oriented router options consistently across client, SSR, and generated router artifacts while preserving existing SSR, RSC, basepath rewrite, and lifecycle hook contracts.
todos:
  - id: define-router-fast-default-contract
    content: Extend the TanStack `RouterConfig`/runtime config surface with an explicit fast-default policy for `defaultStructuralSharing`, documented as the UltraModern default and overridable only through the framework-owned router config path.
    status: completed
  - id: apply-client-router-defaults
    content: Update the browser runtime `createRouter` call in `packages/runtime/plugin-tanstack/src/runtime/plugin.tsx` so cached client routers are created with the fast-default options alongside the existing `routeTree`, rewrite, history, context, and RSC serialization adapters.
    status: completed
  - id: apply-ssr-router-defaults
    content: Update the SSR runtime `createRouter` call in `packages/runtime/plugin-tanstack/src/runtime/plugin.node.tsx` with the same fast-default options, preserving `attachRouterServerSsrUtils`, loader timing, redirect handling, status propagation, and hydration script capture.
    status: completed
  - id: apply-generated-router-defaults
    content: Update `packages/runtime/plugin-tanstack/src/cli/tanstackTypes.ts` so generated `router.gen.ts` files include the same router defaults for type-test and app-authored route API usage.
    status: completed
  - id: add-router-default-regression-tests
    content: Add focused tests that prove browser runtime, SSR runtime, and generated router output include the fast defaults without changing route ids, staticData, loader wrapping, RSC serialization, or basepath rewrite behavior.
    status: completed
  - id: patch-tanstack-version-drift
    content: Evaluate and, if compatible with the new tests, bump the pinned TanStack patch versions from `@tanstack/react-router` 1.170.8 / `@tanstack/router-core` 1.171.6 to the current patch line, updating the create package constants and lockfile together.
    status: completed
isProject: false
---

# TanStack Fast Defaults: Router Runtime

## Execution Notes

The Conductor rewrite article highlights TanStack Router's stable references as the reason navigation stopped cascading through heavy mounted panes. TanStack's own render optimization docs say structural sharing preserves references for URL state and that selector results can opt into structural sharing; RouterOptions also exposes `defaultStructuralSharing`.

Local evidence:

- `packages/runtime/plugin-tanstack/src/runtime/plugin.tsx:221` caches route objects and `:251` caches the route tree/router, but the client `createRouter` call at `:324` does not pass `defaultStructuralSharing`.
- `packages/runtime/plugin-tanstack/src/runtime/plugin.node.tsx:441` creates the SSR router without the same default.
- `packages/runtime/plugin-tanstack/src/cli/tanstackTypes.ts:554` emits a generated `createRouter` call without fast defaults.
- This implementation aligns the repo to `@tanstack/react-router` 1.170.11 and `@tanstack/router-core` 1.171.9 while keeping `@tanstack/history` at 1.162.0.

External evidence:

- https://performance.dev/the-conductor-rewrite
- https://tanstack.com/router/latest/docs/guide/render-optimizations
- https://tanstack.com/router/latest/docs/api/router/RouterOptionsType
- https://github.com/TanStack/router

## Constraints

- Do not add generated-app shims or app-level memoization as the fix. The default must live in the router integration or generated router artifact owner.
- Preserve current basepath rewrite behavior and `basepath: '/'`; the existing Modern rewrite owner is `createModernBasepathRewrite`.
- Preserve SSR/RSC behavior, especially `serverSsr.dehydrate`, buffered hydration scripts, and RSC payload-router handling.
- Keep user override semantics explicit; if a project disables structural sharing, that should be a conscious router config choice, not a hidden app patch.

## Operator Guidance

Run the plugin-level tests first: `pnpm --filter @modern-js/plugin-tanstack test -- --run tests/router/routeTree.test.ts tests/router/tanstackTypes.test.ts`.

If runtime plugin tests need `createRouter` inspection, prefer a focused mock-based unit test over broad browser integration. Add integration coverage only after the fast default is visible in generated app output.
