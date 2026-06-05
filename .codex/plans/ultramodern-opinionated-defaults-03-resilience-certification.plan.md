---
name: ultramodern-opinionated-defaults-03-resilience-certification
overview: Add resilience, i18n metadata, and optional accessibility/performance certification gates after the core defaults are in place, without making arbitrary product UI audits default build blockers.
todos:
  - id: audit-error-status-paths
    content: Audit app-tools, runtime, server, Cloudflare, and generated workspace paths for 404, 500, 503, maintenance, preview, and MF remote fallback status behavior.
    status: pending
  - id: implement-resilience-status-defaults
    content: Implement correct 404/500/503 status behavior, Retry-After maintenance support, production stack leak prevention, non-production noindex, and deterministic MF remote fallback semantics where missing.
    status: pending
  - id: add-localized-metadata-defaults
    content: Add localized metadata and hreflang generation for public routes using existing i18n/localized route metadata without forcing private app screens to define public SEO metadata.
    status: pending
  - id: add-accessibility-certification
    content: Add optional accessibility certification checks for generated starters and teams that opt into strict CI, while leaving arbitrary product UI as certification-only rather than default build failure.
    status: pending
  - id: add-performance-certification
    content: Add optional performance certification for navigation warmup telemetry, Core Web Vitals/RUM readiness, cache policy checks, BFCache diagnostics, and wasted warmup ratio.
    status: pending
  - id: document-certification-rollout
    content: Document how certification differs from defaults, how SuperApp teams adopt the gates, and which failures should block release versus warn in development.
    status: pending
isProject: false
---

# ultramodern-opinionated-defaults-03-resilience-certification

## Execution Notes

Beads issue: `modernjs-a6d4`.

This lane follows after template/security and public surfaces because i18n metadata, generated files, and certification gates need stable route publicness and starter defaults.

Certification should be intentionally more brutal than default builds. The framework should prevent objective defects by default, while certification can evaluate broader accessibility and performance quality.

## Constraints

- Do not make arbitrary product UI accessibility/performance certification a default build blocker.
- Do not expose private route metadata while adding hreflang or localized metadata.
- Do not change MF fallback behavior without preserving existing trust, compatibility, and telemetry contracts.
- Do not add app-level shims to paper over framework/runtime defects.

## Operator Guidance

Depends on `ultramodern-opinionated-defaults-01-template-security` and `ultramodern-opinionated-defaults-02-public-surfaces`.

Useful local references:

- `docs/super-app-rfc-adr/ADR-0002-app-level-mf-ssr-strategy.md`
- `docs/super-app-rfc-adr/ADR-0011-mf-vs-garfish-runtime-parity-contract.md`
- `docs/super-app-rfc-adr/PREFLIGHT-0001-ultramodern-superapp-readiness.md`
- generated route metadata in `packages/toolkit/create/src/ultramodern-workspace.ts`
