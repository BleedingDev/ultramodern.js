---
name: Localised Urls 02 Api Prefix Skip
overview: Ensure i18n locale redirects and language detection never intercept BFF/API prefixes, including root page routes mounted at /* before post-order Effect or Hono BFF handlers.
todos:
  - id: characterize-api-prefix-bug
    content: "Add a focused server-level characterization that a root page route with localePathRedirect would currently redirect /bff-api/* before BFF handlers can run."
    status: pending
  - id: collect-api-prefixes
    content: "Compute segment-safe API prefixes in i18n server prepare from server routes where route.isApi is true and from normalized bff.prefix as a fallback."
    status: pending
  - id: skip-language-detector-for-api
    content: "Apply the API-prefix skip before Hono languageDetector in i18n-language-detector middleware."
    status: pending
  - id: skip-i18n-redirect-for-api
    content: "Apply the same API-prefix skip before static checks, ignoreRedirectRoutes, missing-prefix redirects, and localised URL canonical redirects in i18n-server-middleware."
    status: pending
  - id: prove-segment-safe-matching
    content: "Test exact/prefix matching so /bff-api and /bff-api/ping are skipped but /bff-api-v2 is not skipped by a /bff-api prefix."
    status: pending
  - id: verify-api-prefix-skip
    content: "Run plugin-i18n server/unit checks and at least one integration path showing /bff-api/* returns API output rather than a locale redirect."
    status: pending
isProject: true
---

# Localised Urls 02 Api Prefix Skip

## Execution Notes

BFF adds API server routes in `@modern-js/plugin-bff` via `modifyServerRoutes`; the resulting routes have `isApi: true` and paths such as `/bff-api`. Hono and Effect BFF handlers are mounted later as post-order middleware, while i18n server middleware currently has default order. For a root page route, i18n registers at `/*`, so it can redirect `/bff-api/*` before BFF handles it.

The fix belongs in `packages/runtime/plugin-i18n/src/server/index.ts`. Compute API prefixes once in `api.onPrepare`, then skip both i18n language detection and i18n redirects for matching requests.

Segment-safe matching must be exact or slash-delimited:

- `/bff-api` matches `/bff-api`
- `/bff-api` matches `/bff-api/ping`
- `/bff-api` does not match `/bff-api-v2`
- `/` should not become a blanket skip unless the app is intentionally API-only

## Constraints

Do not depend on middleware order to protect APIs. Do not require users to duplicate BFF prefixes in `ignoreRedirectRoutes` for the default-safe behavior.

Keep user-configured `ignoreRedirectRoutes` working as an additional override after API skips.

Do not localize API routes, Effect endpoints, Hono endpoints, or generated BFF clients.

## References

- `packages/runtime/plugin-i18n/src/server/index.ts`
- `packages/cli/plugin-bff/src/cli.ts`
- `packages/cli/plugin-bff/src/runtime/effect/adapter.ts`
- `packages/cli/plugin-bff/src/runtime/hono/adapter.ts`
- `packages/server/core/src/serverBase.ts`
- `packages/server/core/src/plugins/render/index.ts`
- `tests/integration/bff-hono`
- `tests/integration/bff-runtime-parity`

## Operator Guidance

Favor a small helper with explicit tests over trying to change server middleware ordering. The behavior should be independently correct even if plugin ordering changes later.
