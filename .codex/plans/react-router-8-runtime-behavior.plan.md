---
name: react-router-8-runtime-behavior
overview: Migrate Modern.js runtime, runtime-utils, SSR, RSC, and TanStack bridge behavior to React Router 8 APIs without app-level compatibility hacks.
todos:
  - id: verify-v8-export-surface
    content: Install the selected React Router 8 version in the branch and verify actual exports from react-router and react-router/dom before editing imports.
    status: pending
  - id: preserve-modern-router-exports
    content: Adjust @modern-js/runtime-utils router re-exports so Modern public imports keep working while DOM-specific APIs come from react-router/dom internally.
    status: pending
  - id: migrate-client-router-creation
    content: Update client createBrowserRouter, createHashRouter, RouterProvider, and hydration wiring for React Router 8 options and import paths.
    status: pending
  - id: migrate-server-router-creation
    content: Update createStaticHandler, createStaticRouter, StaticRouterProvider, redirects, status handling, and loader failure handling for React Router 8 behavior.
    status: pending
  - id: adapt-router-context-provider
    content: Convert Modern request context plumbing to RouterContextProvider where React Router 8 loader and action context requires it.
    status: pending
  - id: audit-raw-request-url-behavior
    content: Audit loaders, actions, RSC fetches, SSG, and data request handling for v8 raw request.url behavior and use normalized URL data where needed.
    status: pending
  - id: verify-route-object-compatibility
    content: Re-run and extend route object tests for hasErrorBoundary removal, ErrorBoundary inference, lazy routes, client loaders, and generated handle metadata.
    status: pending
  - id: verify-rsc-and-tanstack-bridges
    content: Prove React Router RSC navigation and TanStack route bridges still preserve loaderData, actions, redirects, deferred data, and route ids.
    status: pending
isProject: false
---

# react-router-8-runtime-behavior

## Execution Notes

This lane depends on `react-router-8-baseline-dependencies`. Do not start broad runtime edits until React Router 8 is actually installed and the real package export surface has been inspected.

Primary local files to inspect and modify:

- `packages/toolkit/runtime-utils/src/router.ts`
- `packages/toolkit/runtime-utils/src/rsc.ts`
- `packages/toolkit/runtime-utils/src/browser/nestedRoutes.tsx`
- `packages/runtime/plugin-runtime/src/router/runtime/plugin.tsx`
- `packages/runtime/plugin-runtime/src/router/runtime/plugin.node.tsx`
- `packages/runtime/plugin-runtime/src/router/runtime/rsc-router.tsx`
- `packages/runtime/plugin-runtime/src/core/context/runtime.ts`
- `packages/runtime/plugin-runtime/src/core/compat/requestContext.ts`
- `packages/runtime/plugin-tanstack/src/runtime/plugin.tsx`
- `packages/runtime/plugin-tanstack/src/runtime/plugin.node.tsx`
- `packages/runtime/plugin-tanstack/src/runtime/loaderBridge.ts`
- `packages/runtime/plugin-tanstack/src/runtime/routeTree.ts`

React Router v8 makes middleware always enabled. The loader, action, and middleware `context` value is always a `RouterContextProvider`, and custom server `getLoadContext` functions must return a `RouterContextProvider`. Modern currently passes a plain `requestContext` object to `query(remixRequest, { requestContext })` in the React Router SSR path, so this is the highest-risk runtime change.

## Constraints

Do not add one-off app wrappers, synthetic navigation handlers, generated fixture patches, or local config suppressions to make broken framework behavior pass. If a route, loader, redirect, or SSR failure is exposed by React Router 8, fix the owning runtime/tooling layer.

Keep Modern public imports stable where practical. If `@modern-js/runtime-utils/router` must keep exporting `RouterProvider`, document why and back it with export tests; otherwise provide a deliberate migration surface and changeset.

Do not remove Modern's internal RSC payload fields solely because React Router removed internal `hasErrorBoundary`. The public route object path is already sanitized; internal payload fields can remain if they are Modern-owned and tested.

## Operator Guidance

Add tests before or with each behavioral edit. The expected focused package gates are:

- `pnpm --filter @modern-js/runtime-utils test`
- `pnpm --filter @modern-js/runtime test`
- `pnpm --filter @modern-js/plugin-tanstack test`
- `pnpm validate:tsgo`

Extend existing tests rather than creating isolated fixtures when possible:

- `packages/runtime/plugin-runtime/tests/router/utils.test.ts`
- `packages/runtime/plugin-runtime/tests/router/lifecycle.test.tsx`
- `packages/runtime/plugin-runtime/tests/router/prefetch.test.tsx`
- `packages/runtime/plugin-runtime/tests/ssr/serverRender/requestHandler.test.tsx`
- `packages/runtime/plugin-runtime/tests/router/internalProvider.test.ts`
- `packages/runtime/plugin-tanstack/tests/router/loaderBridge.test.ts`
- `packages/runtime/plugin-tanstack/tests/router/routeTree.test.ts`
- `packages/runtime/plugin-tanstack/tests/router/rsc.test.tsx`

Prove server and client paths independently. A green client route test does not prove `RouterContextProvider` or raw data request URL behavior; those need SSR/RSC assertions.
