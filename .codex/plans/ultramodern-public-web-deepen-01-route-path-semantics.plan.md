---
name: ultramodern-public-web-deepen-01-route-path-semantics
overview: Collapse duplicated route path semantics across generated route head, public-surface asset generation, and tests so localization, canonical paths, dynamic params, and public URL paths have one generator-owned source of truth.
todos:
  - id: characterize-route-path-behavior
    content: Add or confirm focused characterization coverage for localized canonical paths, dynamic route params, provider discovery paths, sitemap URL paths, and SSR head URL expectations.
    status: completed
  - id: define-route-path-semantics-module
    content: Define a small internal route path semantics module or cohesive section that can generate shared route path decisions without changing generated contract shapes.
    status: completed
  - id: refactor-head-and-surface-consumers
    content: Rewire generated route head and public-surface asset generation to consume the shared route path semantics decisions while preserving generated output behavior.
    status: completed
  - id: validate-route-path-semantics
    content: Run focused create integration tests and Biome checks, then inspect generated route metadata/head/public-surface output for unintentional drift.
    status: completed
isProject: false
---

# ultramodern-public-web-deepen-01-route-path-semantics

## Execution Notes

This is the top architecture-review recommendation. Current generated code duplicates route normalization and localized path construction in `createRouteHeadModule` and `createPublicSurfaceAssetsScript`. The goal is locality: one module owns route path decisions, while generated consumers keep their existing public contracts.

## Constraints

Do not change route metadata shape, `ultramodern-route-metadata.ts` exports, `routes.publicSurface` contract keys, sitemap output semantics, `hreflang`, canonical URL rules, provider discovery compatibility, or private-first behavior. Do not import page modules, React pages, CSS, or client code during public-surface generation.

## Operator Guidance

Treat `packages/toolkit/create/src/ultramodern-workspace.ts` as a single-writer hotspot for implementation. Read-only scouts may inspect it in parallel. Run `pnpm --dir tests exec rstest run integration/create-ultramodern-workspace/tests/index.test.ts` after each structural change.
