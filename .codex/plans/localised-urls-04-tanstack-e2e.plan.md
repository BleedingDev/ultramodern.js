---
name: Localised Urls 04 Tanstack E2e
overview: Add TanStack-priority integration coverage proving localisedUrls route generation, SSR, client navigation, I18nLink/changeLanguage behavior, and type generation all work with localized path aliases.
todos:
  - id: create-tanstack-localised-fixture
    content: "Create a focused tests/integration/i18n/routes-tanstack-localised fixture based on the routes-tanstack build/serve/typecheck pattern."
    status: pending
  - id: configure-tanstack-and-i18n
    content: "Configure appTools, tanstackRouterPlugin, i18nPlugin, SSR string mode, localePathRedirect true, and a complete English/Czech localisedUrls map."
    status: pending
  - id: add-tanstack-localised-routes
    content: "Build a [lang] route tree with localized aliases for static, dynamic, and optional params, using TanStack Link/navigation from @modern-js/plugin-tanstack/runtime."
    status: pending
  - id: cover-tanstack-build-and-types
    content: "Run modernBuild and TS-Go typecheck to prove generated TanStack route types accept the localized route set."
    status: pending
  - id: cover-tanstack-ssr
    content: "Fetch /cs/produkty/bota and assert TanStack SSR bootstrap plus localized loader/page data are present."
    status: pending
  - id: cover-tanstack-client-navigation
    content: "Use Puppeteer to navigate from /en/products/shoe through language switching and/or I18nLink to /cs/produkty/shoe, asserting URL and data without reload regressions."
    status: pending
  - id: cover-tanstack-api-prefix-safety
    content: "If the fixture includes BFF, assert /bff-api/* is not locale-redirected under TanStack SSR."
    status: pending
  - id: verify-tanstack-e2e
    content: "Run the new TanStack localisedUrls integration suite plus existing routes-tanstack tests as regression coverage."
    status: pending
isProject: true
---

# Localised Urls 04 Tanstack E2e

## Execution Notes

This is the priority E2E lane. Reuse the proven harness from `tests/integration/routes-tanstack`: build first, run TS-Go against generated routes, serve the built app, then use fetch and Puppeteer for SSR/client assertions.

The fixture should demonstrate that localised route aliases produced by `@modern-js/plugin-i18n` are accepted by TanStack route generation and runtime matching. It must also prove the runtime adapter from plan 01 is actually used, not bypassed by full page reloads or anchor fallback.

Recommended fixture: `tests/integration/i18n/routes-tanstack-localised`.

## Constraints

Do not make TanStack depend on React Router exports. Keep TanStack imports from `@modern-js/plugin-tanstack/runtime` or the existing Modern TanStack subpath used by the fixture.

Do not rely only on build success. Browser navigation must prove runtime language switching and localized paths.

## References

- `tests/integration/routes-tanstack`
- `packages/runtime/plugin-tanstack/src/runtime/plugin.tsx`
- `packages/runtime/plugin-tanstack/src/runtime/routeTree.ts`
- `packages/runtime/plugin-tanstack/src/runtime/prefetchLink.tsx`
- `packages/runtime/plugin-runtime/src/router/runtime/tanstack/plugin.tsx`
- `packages/runtime/plugin-runtime/src/exports/tanstack-router.ts`

## Operator Guidance

Keep this fixture smaller than the general `routes-tanstack` suite. It should target i18n-localized URL integration, not retest every TanStack feature.
