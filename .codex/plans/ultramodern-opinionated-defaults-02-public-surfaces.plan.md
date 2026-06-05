---
name: ultramodern-opinionated-defaults-02-public-surfaces
overview: Implement private-first route publicness and generated public surfaces for app-first UltraModern projects, generating robots, sitemap, security.txt, llms, manifest, and API catalogs only from safe public inputs.
todos:
  - id: define-minimal-route-publicness-api
    content: Define the smallest route metadata surface needed for publicness: public/indexable flag, title, description, canonical inference, locale awareness, and opt-out behavior without requiring route owner/id/canonicalPath from app authors.
    status: pending
  - id: implement-private-first-defaults
    content: Implement private-first defaults so app screens do not become indexable or sitemap-visible unless generated as public starter routes or explicitly marked public.
    status: pending
  - id: generate-robots-and-sitemap
    content: Generate robots.txt and sitemap.xml from public/indexable routes, locale metadata, and environment-aware production/non-production policies.
    status: pending
  - id: generate-safe-well-known-surfaces
    content: Generate safe well-known surfaces such as security.txt and app manifest when configured or inferable, with no exposure of private tenant/auth/user data.
    status: pending
  - id: add-llms-and-api-catalog-auto
    content: Add auto generation for llms.txt and API catalogs only when public docs/help/product/API inputs exist, with private apps producing minimal or disabled output.
    status: pending
  - id: add-public-surface-validation
    content: Add validation proving private routes are excluded, public routes are included, sitemap follows indexability, non-production is noindex, and generated surfaces require no app boilerplate for safe defaults.
    status: pending
isProject: false
---

# ultramodern-opinionated-defaults-02-public-surfaces

## Execution Notes

Beads issue: `modernjs-04jb`.

Accepted direction:

- App screens default private/non-indexable.
- Publicness is opt-in for app routes and can be generated true for explicit landing/docs/help/product starter routes.
- `sitemap` follows `index`.
- `/llms.txt` is useful only for public docs/help/product/API surfaces, not private dashboard screens.
- JSON-LD is out of scope and deferred to `modernjs-b5cb` and `modernjs-sddt`.

## Constraints

- Do not expose private routes, auth routes, tenant URLs, user data, or internal APIs through generated files.
- Do not require app authors to fill owner, id, canonicalPath, or structuredData for normal app screens.
- Do not emit rich agent/MCP/A2A discovery by default.
- Keep generated public surfaces deterministic and environment-aware.

## Operator Guidance

Depends on `ultramodern-opinionated-defaults-00-contract`.

This lane can run in parallel with template/security after the contract is accepted. Coordinate with resilience/i18n before finalizing localized sitemap and hreflang behavior.
