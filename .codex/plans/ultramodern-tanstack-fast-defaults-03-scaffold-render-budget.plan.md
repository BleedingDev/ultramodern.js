---
name: ultramodern-tanstack-fast-defaults-03-scaffold-render-budget
overview: Make generated UltraModern apps model TanStack Router's fast primitives by replacing full-page navigation fallbacks and broad location subscriptions with route-aware links, navigation, selectors, and render-budget tests.
todos:
  - id: replace-shell-language-hard-navigation
    content: Update the generated shell frame in `packages/toolkit/create/src/ultramodern-workspace.ts` to use the i18n/router adapter or TanStack `useNavigate` for language changes instead of `window.location.assign`, preserving locale path resolution and search/hash suffixes.
    status: pending
  - id: replace-template-anchor-language-links
    content: Update `packages/toolkit/create/template/src/routes/[lang]/page.tsx.handlebars` so TanStack-generated starters use the router-aware `I18nLink`/`Link` path instead of raw anchors for internal language navigation.
    status: pending
  - id: narrow-location-subscriptions
    content: Replace generated broad `useLocation()` reads with selector-based location reads for `pathname`, `searchStr`/`search`, and `hash` where supported by the runtime export, so unrelated router state does not rerender generated shell surfaces.
    status: pending
  - id: harden-i18n-tanstack-adapter-selectors
    content: Review `packages/runtime/plugin-i18n/src/runtime/routerAdapter.tsx` subscriptions and params/location derivation, then use TanStack store selectors or stable snapshots where possible instead of manual version bumps on broad router events.
    status: pending
  - id: add-render-budget-fixture
    content: Add a small TanStack integration fixture with a mounted shell/sidebar and heavy child pane, route search updates, and render counters that fail if unrelated shell panes rerender beyond the approved budget.
    status: pending
  - id: validate-generated-workspace-navigation
    content: Regenerate a fresh UltraModern workspace and run browser smoke tests proving internal language changes use client navigation, preserve search/hash, avoid full reloads, and keep SSR/i18n canonical links correct.
    status: pending
isProject: false
---

# TanStack Fast Defaults: Scaffold Render Budget

## Execution Notes

Generated apps are how users learn the framework defaults. If those apps use raw anchors, broad location objects, or hard navigation for internal transitions, UltraModern teaches the opposite of the Conductor lesson.

Local evidence:

- `packages/toolkit/create/src/ultramodern-workspace.ts:2350` reads the full location object and `:2369` calls `window.location.assign` during shell language changes.
- The single-app template `packages/toolkit/create/template/src/routes/[lang]/page.tsx.handlebars` computes language `href`s and renders raw anchors for internal language routes.
- `packages/runtime/plugin-i18n/src/runtime/routerAdapter.tsx` already has a TanStack-aware `router.navigate` path and exposes router-aware `Link`, so the fix can stay in framework/runtime scaffolding instead of adding app shims.
- `tests/integration/superapp-portfolio/src/routes/layout.tsx` shows route data consumption through `useMatch({ from: '__root__' })`; future render-budget tests can reuse this style rather than switching to React Router APIs.

External evidence:

- https://performance.dev/the-conductor-rewrite
- https://tanstack.com/router/latest/docs/guide/render-optimizations
- https://tanstack.com/router/latest/docs/api/router/RouteApiType

## Constraints

- Follow the repo rule forbidding app-level navigation shims, synthetic link handlers, and demo patches. The owner is generated scaffold code or shared runtime/i18n adapter code.
- Preserve localized URL semantics, canonical/alternate head tags, and search/hash retention.
- Do not introduce full-page reloads for internal route changes unless explicitly handling a no-router fallback.
- Keep generated examples small; render-budget probes belong in tests, not visible product UI.

## Operator Guidance

This lane can run after the router-runtime defaults are in place, but it does not need to wait for the search-contract lane. Use integration tests for generated behavior and a focused unit test for `routerAdapter` stability before attempting broader browser smoke.
