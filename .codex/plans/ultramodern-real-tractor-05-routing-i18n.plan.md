---
name: Ultramodern Real Tractor 05 Routing I18n
overview: Design route-owned localization and routing metadata for real Explore, Decide, and Checkout remotes while preserving native Modern.js i18n and Cloudflare SSR.
todos:
  - id: define-route-owned-metadata-api
    content: "Design a route-owned metadata export API for localized paths, canonical URLs, hreflang, route ownership, MF boundary id, locale namespace, and optional shell override hooks."
    status: completed
  - id: define-generated-route-map
    content: "Define how central route maps are generated from route-owned metadata while still allowing explicit manual overrides for production migrations or legacy URLs."
    status: completed
  - id: define-localized-route-set
    content: "Define Tractor route coverage in English and Czech: home/listing/store picker, product detail, cart, checkout, thanks/order confirmation, and unavailable fallback routes."
    status: completed
  - id: define-i18n-resource-ownership
    content: "Define per-vertical i18n namespace ownership and loading so each remote owns its translations and can serve static JSON from CDN/Cloudflare assets or load through an external translation service."
    status: completed
  - id: define-dynamic-i18n-backend
    content: "Design opt-in dynamic translation loading using native Modern.js/plugin-i18n backend options, with cache headers, CDN paths, error fallback, and no regression to inline-only behavior."
    status: completed
  - id: define-language-switching-contract
    content: "Define shell and remote language switching behavior so switching language preserves the current domain route where possible and remotes receive consistent locale context."
    status: completed
  - id: define-i18n-validation
    content: "Define HTTP and browser validation for localized SSR HTML, locale JSON, dynamic backend loading, canonical/hreflang metadata, Czech diacritics, and route transitions."
    status: completed
isProject: true
---

# Ultramodern Real Tractor 05 Routing I18n

## Execution Notes

This plan resolves the earlier route concern: route definitions should own route metadata, and the central map should be generated from those exports. Both approaches can coexist if the override path is explicit.

Native Modern.js i18n remains mandatory. Dynamic translation JSON must be supported as an option, but the deterministic Cloudflare starter can still embed or statically serve baseline resources.

## Constraints

- No conditional `language === 'cs' ? ...` UI text in generated React views.
- Do not disable i18n.
- Do not force one central hand-written route file as the only source of truth.
- Do not make external translation services required for the baseline generated app.

## Operator Guidance

Start with static JSON assets for deterministic validation. Add dynamic backend proof after route-owned namespace metadata is in place.

