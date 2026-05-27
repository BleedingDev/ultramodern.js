---
name: Localised Urls 01 Router Adapter
overview: Replace React Router-shaped i18n navigation assumptions with a small normalized adapter that supports TanStack Router first while preserving existing React Router and no-router behavior.
todos:
  - id: characterize-current-router-assumptions
    content: "Add focused characterization coverage for current i18n runtime navigation assumptions: React Router changeLanguage, client redirect fallback, and I18nLink href generation."
    status: pending
  - id: design-normalized-i18n-navigation-contract
    content: "Introduce an i18n-owned navigation contract with normalized location, navigate(href, { replace }), optional Link, and framework metadata; keep it internal to @modern-js/plugin-i18n."
    status: pending
  - id: implement-tanstack-adapter-path
    content: "Use Modern runtime context routerFramework/routerRuntime/context.router to adapt TanStack useLocation/useRouter/useNavigate to the normalized i18n navigation contract without importing @modern-js/plugin-tanstack into plugin-i18n."
    status: pending
  - id: preserve-react-router-adapter-path
    content: "Preserve existing React Router behavior through the current @modern-js/runtime/router hooks, including manual BrowserRouter fixtures that are not managed by Modern's internal router runtime."
    status: pending
  - id: migrate-i18n-runtime-call-sites
    content: "Move useModernI18n changeLanguage, useClientSideRedirect, useLanguageSync, and I18nLink onto the normalized adapter; remove broad catch-all masking that hides real router failures."
    status: pending
  - id: verify-router-adapter
    content: "Run plugin-i18n typecheck and focused runtime tests proving TanStack navigation uses navigate({ to, replace }) while React Router still uses navigate(href, { replace })."
    status: pending
isProject: true
---

# Localised Urls 01 Router Adapter

## Execution Notes

This is the highest-priority implementation lane. The current runtime code is React Router-shaped: `I18nLink` imports `Link`, `useInRouterContext`, and `useParams` from `@modern-js/runtime/router`; `useRouterHooks` dynamically requires `@modern-js/runtime/router`; `changeLanguage` calls `navigate(newUrl, { replace: true })`.

TanStack must be supported through the Modern runtime router state and hook bag, not by pretending `@modern-js/runtime/router` is TanStack-aware. Both router implementations already write generic state via `applyRouterRuntimeState`; TanStack also populates `context.router` with `useLocation`, `useNavigate`, and `useRouter`.

The adapter should normalize:

- `framework`
- `hasRouter`
- `location: { pathname, search, hash }`
- `navigate(href, { replace })`
- optional `Link`

For TanStack, normalize `location.searchStr` before `location.search`, and call `router.navigate({ to: href, replace })` or `useNavigate()({ to: href, replace })`. Never call TanStack navigation with the React Router positional signature.

## Constraints

Do not repoint `@modern-js/runtime/router`; it is the React Router export. Do not add a hard dependency from `@modern-js/plugin-i18n` to `@modern-js/plugin-tanstack` or `@tanstack/react-router`.

Keep manual React Router usage working. Existing i18n fixtures can render their own `BrowserRouter`; relying only on Modern internal runtime context would degrade those apps to anchors.

Do not collapse server URL logic into runtime-only code. This lane owns runtime navigation only.

## References

- `packages/runtime/plugin-i18n/src/runtime/I18nLink.tsx`
- `packages/runtime/plugin-i18n/src/runtime/context.tsx`
- `packages/runtime/plugin-i18n/src/runtime/hooks.ts`
- `packages/runtime/plugin-i18n/src/runtime/utils.ts`
- `packages/runtime/plugin-runtime/src/router/runtime/lifecycle.ts`
- `packages/runtime/plugin-runtime/src/router/runtime/plugin.tsx`
- `packages/runtime/plugin-runtime/src/router/runtime/tanstack/plugin.tsx`
- `packages/runtime/plugin-tanstack/src/runtime/plugin.tsx`
- `packages/runtime/plugin-tanstack/src/runtime/prefetchLink.tsx`

## Operator Guidance

Start test-first at the adapter boundary. Keep the adapter small and boring. The goal is not a new public router API; it is to remove hidden React Router assumptions from i18n.
