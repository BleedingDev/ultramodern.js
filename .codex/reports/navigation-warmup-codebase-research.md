# Navigation Warmup Codebase Research

## Scope

- Repository: `/Users/satan/side/experiments/modernjs`
- Branch: `main-ultramodern`
- Target question: what code paths, contracts, tests, and edge cases matter for implementing only UltraModern navigation warmup defaults.
- In scope: runtime Link/NavLink prefetching, TanStack link adapters, i18n link forwarding, route manifest assets, focused tests, and MF timing caveats.
- Out of scope: starter correctness, security headers, public surfaces, resilience, certification, route indexing, agent readiness, and JSON-LD/schema work.

## Executive Summary

Classic runtime navigation warmup is centered in `packages/runtime/plugin-runtime/src/router/runtime/PrefetchLink.tsx`. It currently supports `prefetch: 'intent' | 'render' | 'none'`, defaults to `none`, skips absolute URLs, loads matched route chunks through `WEBPACK_CHUNK_LOAD`, and emits loader-data prefetch links when `window._SSR_DATA` exists.

TanStack navigation warmup already has the `viewport` vocabulary in two adapter copies: `packages/runtime/plugin-runtime/src/router/runtime/tanstack/prefetchLink.tsx` and `packages/runtime/plugin-tanstack/src/runtime/prefetchLink.tsx`. Both preserve explicit TanStack `preload` props, which is a hard requirement for the accepted default.

`I18nLink` is a forwarding layer: it localizes `to`, then passes arbitrary props through to the active router Link. This makes i18n compatibility a test problem, not a new API problem.

The main safety gap is classic runtime data prefetch: render-time prefetch currently can produce loader-data fetch hints in SSR contexts. The accepted default requires render-time warmup to avoid private/credentialed data unless a route explicitly opts in.

## System Map

- Classic runtime Link surface:
  - `packages/runtime/plugin-runtime/src/router/runtime/index.ts` exports `Link` and `NavLink` from `PrefetchLink`.
  - `packages/runtime/plugin-runtime/src/router/runtime/PrefetchLink.tsx` owns classic prefetch behavior.
- TanStack adapter surfaces:
  - `packages/runtime/plugin-runtime/src/exports/tanstack-router.ts` exports TanStack `Link`, `NavLink`, and `PrefetchBehavior`.
  - `packages/runtime/plugin-runtime/src/router/runtime/tanstack/prefetchLink.tsx` is the runtime-owned TanStack adapter.
  - `packages/runtime/plugin-tanstack/src/runtime/index.tsx` exports the plugin package adapter.
  - `packages/runtime/plugin-tanstack/src/runtime/prefetchLink.tsx` duplicates the same adapter logic and must remain in sync.
- i18n forwarding:
  - `packages/runtime/plugin-i18n/src/runtime/I18nLink.tsx` localizes the target and spreads remaining props onto the router Link.
  - `packages/runtime/plugin-i18n/src/runtime/routerAdapter.tsx` exposes the active router Link from runtime context.
- Route asset contract:
  - `packages/runtime/plugin-runtime/src/router/runtime/types.ts` defines `RouteManifest.routeAssets` and `RouteAssets[routeId].chunkIds`.
  - `packages/runtime/plugin-runtime/src/core/context/runtime.ts` carries `routeManifest` in `InternalRuntimeContext`.

## Trace

Classic runtime:

1. App imports `Link`/`NavLink` from `@modern-js/runtime/router`, exported through `packages/runtime/plugin-runtime/src/router/runtime/index.ts`.
2. `PrefetchLink.tsx` wraps React Router `Link`/`NavLink`.
3. `usePrefetchBehavior` sets `shouldPrefetch` immediately for `render` and after focus/hover/touch delay for `intent`.
4. When `shouldPrefetch` is true, the wrapper resolves the target path, rejects absolute URLs, and renders `PrefetchPageLinks`.
5. `PrefetchPageLinks` reads `routes` and `routeManifest` from `InternalRuntimeContext`, matches routes, and calls `loadRouteModule` for each match.
6. `loadRouteModule` loads matched route chunks through `WEBPACK_CHUNK_LOAD`.
7. If `window._SSR_DATA` is present, `PrefetchDataLinks` may emit loader-data `<link rel="prefetch" as="fetch">` URLs for matched loaders.

TanStack:

1. App imports `Link` from either `@modern-js/runtime/tanstack-router` or `@modern-js/plugin-tanstack/runtime`.
2. The adapter accepts `prefetch?: 'intent' | 'render' | 'viewport' | 'none'`.
3. If the user supplied a TanStack `preload` prop, the adapter preserves it.
4. Otherwise, `prefetch="viewport"` maps directly to TanStack `preload="viewport"`.

i18n:

1. `I18nLink` builds a localized `to`.
2. If a router Link exists, `I18nLink` renders `<Link to={localizedTo} {...props}>`.
3. Warmup props therefore should flow through unchanged.

## Evidence

- Classic `PrefetchBehavior` currently lacks `viewport`: `packages/runtime/plugin-runtime/src/router/runtime/PrefetchLink.tsx:53`.
- Classic Link default is `prefetch = 'none'`: `packages/runtime/plugin-runtime/src/router/runtime/PrefetchLink.tsx:277`.
- Classic render prefetch flips `shouldPrefetch` in an effect: `packages/runtime/plugin-runtime/src/router/runtime/PrefetchLink.tsx:85`.
- Classic intent prefetch uses focus/hover/touch handlers: `packages/runtime/plugin-runtime/src/router/runtime/PrefetchLink.tsx:91`.
- Classic route chunk warmup uses `routeAssets[routeId].chunkIds` and `WEBPACK_CHUNK_LOAD`: `packages/runtime/plugin-runtime/src/router/runtime/PrefetchLink.tsx:127`.
- Classic absolute URL skip is present: `packages/runtime/plugin-runtime/src/router/runtime/PrefetchLink.tsx:60` and `packages/runtime/plugin-runtime/src/router/runtime/PrefetchLink.tsx:278`.
- Classic data prefetch is gated only by `window._SSR_DATA`, not by public/private route policy: `packages/runtime/plugin-runtime/src/router/runtime/PrefetchLink.tsx:195`.
- Data prefetch emits `<link rel="prefetch" as="fetch">`: `packages/runtime/plugin-runtime/src/router/runtime/PrefetchLink.tsx:168`.
- TanStack runtime adapter supports `viewport`: `packages/runtime/plugin-runtime/src/router/runtime/tanstack/prefetchLink.tsx:9`.
- Plugin TanStack adapter supports `viewport`: `packages/runtime/plugin-tanstack/src/runtime/prefetchLink.tsx:9`.
- Both TanStack adapters preserve explicit `preload`: `packages/runtime/plugin-runtime/src/router/runtime/tanstack/prefetchLink.tsx:15` and `packages/runtime/plugin-tanstack/src/runtime/prefetchLink.tsx:15`.
- I18nLink forwards props to active router Link: `packages/runtime/plugin-i18n/src/runtime/I18nLink.tsx:63`.
- i18n router adapter exposes the runtime Link shape: `packages/runtime/plugin-i18n/src/runtime/routerAdapter.tsx:35`.
- Existing classic tests cover `intent` and `render`: `packages/runtime/plugin-runtime/tests/router/prefetch.test.tsx:74`.
- Existing TanStack adapter tests cover viewport mapping and explicit override preservation: `packages/runtime/plugin-runtime/tests/router/tanstackPrefetchLink.test.tsx:24` and `packages/runtime/plugin-tanstack/tests/router/prefetchLink.test.tsx:24`.
- MF parity docs identify prefetch/routing timing as a known runtime non-equivalence: `docs/super-app-rfc-adr/ADR-0011-mf-vs-garfish-runtime-parity-contract.md:138`.

## Impact Surface

- Primary edit surface:
  - `packages/runtime/plugin-runtime/src/router/runtime/PrefetchLink.tsx`
- Sync surfaces:
  - `packages/runtime/plugin-runtime/src/router/runtime/tanstack/prefetchLink.tsx`
  - `packages/runtime/plugin-tanstack/src/runtime/prefetchLink.tsx`
  - `packages/runtime/plugin-i18n/src/runtime/I18nLink.tsx` only if tests reveal prop forwarding gaps.
- Contract/type surface:
  - `packages/runtime/plugin-runtime/src/router/runtime/types.ts` if route-level data warmup opt-in metadata is needed.
- Test surface:
  - `packages/runtime/plugin-runtime/tests/router/prefetch.test.tsx`
  - `packages/runtime/plugin-runtime/tests/router/tanstackPrefetchLink.test.tsx`
  - `packages/runtime/plugin-tanstack/tests/router/prefetchLink.test.tsx`
  - `packages/runtime/plugin-i18n/tests/routerAdapter.test.tsx`

## Variants And Edge Cases

- Classic runtime currently has no Save-Data, effective connection type, or concurrency guard evidence in the searched code paths.
- TanStack behavior is delegated to TanStack Router through `preload`; UltraModern should not override explicit user `preload`.
- Existing generated single-app starter links are mostly external anchors, so starter edits are not required to prove runtime warmup behavior.
- Generated UltraModern workspace code uses `I18nLink` and `@modern-js/plugin-tanstack/runtime` Link in internal routes, so i18n/TanStack compatibility matters even if starter markup is out of scope.
- MF/SuperApp timing can differ from non-federated routing; the implementation should document timing caveats and avoid bypassing existing MF trust/fallback contracts.

## Hypotheses

- CONFIRMED: Classic runtime does not support `viewport` today. Evidence: `PrefetchBehavior` is only `intent | render | none`.
- CONFIRMED: Classic render prefetch can currently emit loader-data prefetch links when SSR data exists. Evidence: `PrefetchPageLinks` returns `PrefetchDataLinks` when `window._SSR_DATA` is truthy.
- CONFIRMED: TanStack adapters already support `viewport` and preserve explicit `preload`. Evidence: both adapter files and tests.
- CONFIRMED: I18nLink is compatible with warmup props by construction because it spreads props onto the active router Link.
- UNRESOLVED: The exact route-level opt-in shape for safe data warmup does not exist in the current router types. It needs to be defined before render-time data prefetch can be safely enabled by default.

## Confidence And Open Questions

Confidence is high for file ownership and current behavior because the claims are backed by source and tests. The main open design question is the minimal data warmup opt-in contract: whether it belongs on route objects, route metadata, or a separate runtime policy. That should be resolved in the first plan todo before implementation.

## Next Steps

1. Keep the plan graph to the single navigation plan.
2. Define the warmup contract before editing runtime code.
3. Implement classic runtime `viewport` semantics and safe render-time policy first.
4. Keep TanStack adapter work limited to sync/default semantics and tests.
5. Add i18n forwarding coverage.
6. Run focused package tests before any broader suite.
