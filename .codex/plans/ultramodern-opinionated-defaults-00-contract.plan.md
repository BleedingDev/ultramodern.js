---
name: ultramodern-opinionated-defaults-00-contract
overview: Record the accepted UltraModern opinionated defaults contract so implementation stays small, app-first, strict where correctness is objective, and free of broad webSpec/profile black magic.
todos:
  - id: write-accepted-defaults-contract
    content: Write the accepted defaults contract covering no broad webSpec profile, app screens private by default, template-first accessibility, strict security with escape hatches, conservative navigation warmup, and JSON-LD deferral.
    status: pending
  - id: classify-default-ownership
    content: Classify each accepted default as framework-enforced, template-authored, generated-public-surface, certification-only, or deferred so later implementation does not over-enforce arbitrary product UI.
    status: pending
  - id: document-indexability-policy
    content: Document private-first app indexability: app screens default non-indexable, public routes opt in, and sitemap generation follows route publicness/indexability.
    status: pending
  - id: define-dangerous-opt-out-policy
    content: Define the shape for dangerous but valid opt-outs, including disabled viewport zoom, CSP disable/report-only, iframe embedding, legacy third-party widgets, and enterprise SSO exceptions.
    status: pending
  - id: update-tracking-links
    content: Link the accepted contract to Beads issues modernjs-99vw, modernjs-5dic, modernjs-fikq, modernjs-04jb, modernjs-a6d4, modernjs-ztla, modernjs-b5cb, and modernjs-sddt.
    status: pending
isProject: false
---

# ultramodern-opinionated-defaults-00-contract

## Execution Notes

Beads issue: `modernjs-99vw`.

Accepted direction:

- Do not add a broad `webSpec`, `performance/security/agentReadiness` profile system, or hidden compliance engine.
- Use Website Spec as checklist vocabulary only; implement concrete defaults in the owning framework/runtime/template layer.
- UltraModern is app-first, so private app screens must not be indexed or included in public generated surfaces by default.
- Generated templates should model good web and accessibility defaults, but arbitrary product UI should not be hard-failed except for objective framework-owned defects.
- Navigation warmup proceeds through `ultramodern-navigation-warmup-defaults.plan.md`.
- Starter correctness proceeds through `ultramodern-starter-web-correctness.plan.md`.
- JSON-LD/schema work is deferred to `modernjs-b5cb` and `modernjs-sddt`.

## Constraints

- Do not create implementation work for JSON-LD beyond linking the deferred issues.
- Do not invent a large site-quality config surface.
- Do not force users to configure metadata for normal private app screens.
- Keep the contract short enough that implementation owners can actually follow it.

## Operator Guidance

This plan gates the rest of the roadmap. Run it before implementing security/template/public-surface/resilience work so downstream agents inherit the same accepted boundaries.
