---
name: Localised Urls 03 React Router E2e
overview: Add focused React Router integration coverage for localisedUrls so SSR redirects, canonicalization, dynamic paths, language switching, and API prefix safety are proven end to end.
todos:
  - id: create-react-router-localised-fixture
    content: "Create a focused tests/integration/i18n/routes-localised-urls fixture based on routes-ssr instead of mutating broad existing prefix-only fixtures."
    status: pending
  - id: configure-complete-localised-map
    content: "Configure languages ['en', 'cs'], fallbackLanguage 'en', localePathRedirect true, and complete localisedUrls entries for /about, /products, and /products/:slug."
    status: pending
  - id: add-react-router-pages
    content: "Add pages/loaders that render current language, localized static route content, dynamic product slug content, and controls using useModernI18n/I18nLink."
    status: pending
  - id: cover-server-redirects-and-canonicalization
    content: "Test /about redirects to /en/about for English detection, Czech detection redirects to /cs/o-nas, and /cs/about canonicalizes to /cs/o-nas."
    status: pending
  - id: cover-client-language-switching
    content: "Hydrate an English product page, switch to Czech, and assert URL becomes /cs/produkty/<slug> without losing rendered data."
    status: pending
  - id: cover-api-prefix-safety
    content: "Include a small BFF endpoint or fetch check proving /bff-api is not redirected when i18n root middleware is active."
    status: pending
  - id: verify-react-router-e2e
    content: "Run the new React Router localisedUrls integration suite plus existing routes-ssr/routes-csr i18n suites as regression coverage."
    status: pending
isProject: true
---

# Localised Urls 03 React Router E2e

## Execution Notes

The existing React Router i18n route fixtures are good harnesses but deliberately set `localisedUrls: false` to preserve prefix-only behavior. This lane should create a focused fixture so default strict localized URL behavior is proven without rewriting unrelated fixture intent.

Recommended fixture: `tests/integration/i18n/routes-localised-urls`.

Required map:

- `/about`: `en: /about`, `cs: /o-nas`
- `/products`: `en: /products`, `cs: /produkty`
- `/products/:slug`: `en: /products/:slug`, `cs: /produkty/:slug`

Use existing helpers from `tests/integration/i18n/test-utils.ts` for clean state, SSR retry, and hydration waits.

## Constraints

Do not remove `localisedUrls: false` from prefix-only fixtures unless their tests are rewritten intentionally. This lane proves React Router parity, not broad fixture migration.

If BFF is included in the fixture, keep the API surface tiny and only for redirect safety. Deeper BFF runtime parity remains covered elsewhere.

## References

- `tests/integration/i18n/routes-ssr`
- `tests/integration/i18n/routes-csr`
- `tests/integration/i18n/test-utils.ts`
- `tests/utils/modernTestUtils.js`
- `packages/runtime/plugin-i18n/tests/localisedUrls.test.ts`

## Operator Guidance

Make the fixture readable and domain-specific enough to catch wrong-path behavior. Assertions should check final URLs and rendered content, not only status codes.
