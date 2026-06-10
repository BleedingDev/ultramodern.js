---
name: ultramodern-public-web-simplify-02-generator-module
overview: Deepen the public web generator implementation so route metadata projection, content source expansion, public artifact rendering, and generated contract fragments live behind a smaller create-package interface.
todos:
  - id: inventory-public-web-functions
    content: Inventory public web generation functions in ultramodern-workspace.ts and classify them as route metadata projection, content expansion, artifact rendering, contract rendering, validation, or generated script glue.
    status: pending
  - id: define-module-seam
    content: Define a small internal public web generator interface that keeps current output shapes stable while hiding routeEntries, concreteUrlPaths, contentSources, and artifact lifecycle details from unrelated create flow code.
    status: pending
  - id: add-output-characterization
    content: Add or strengthen characterization tests for generated route.meta.ts files, generated compatibility manifest, public surface contract, generated asset script, and dynamic sitemap smoke output before moving code.
    status: pending
  - id: extract-generator-module
    content: Move public web generator implementation into a focused internal module or cohesive section with exported helpers only where existing package structure requires it, preserving generated file content except for intentional formatting stability.
    status: pending
  - id: update-readme-dx-wording
    content: Update UltraModern create README wording so route metadata is described as colocated authoring with a generated compatibility manifest, not as authors editing src/routes/ultramodern-route-metadata.
    status: pending
  - id: validate-generator-refactor
    content: Run create-ultramodern integration tests, create package tests, and generated workspace contract validation to prove public web outputs did not drift.
    status: pending
isProject: false
---

# ultramodern-public-web-simplify-02-generator-module

## Execution Notes

This lane targets the public web generation code recently added to `packages/toolkit/create/src/ultramodern-workspace.ts`: colocated route metadata generation, generated compatibility manifest, public surface contract, generated public-surface asset script, route-owned sitemap provider support, and public head contract wiring.

The goal is locality: public web authoring and artifact lifecycle should be understandable in one module. The create flow should call a small interface instead of knowing every public surface detail.

## Constraints

This is a behavior-preserving refactor. Do not change generated routes, public route metadata shape, `ultramodernLocalisedUrls`, `ultramodernPublicRoutes`, generated contract keys, generated script names, build scripts, CLI flags, or public artifact contents unless tests show the old output was invalid. Do not remove the generated compatibility manifest yet; it remains needed by current config/i18n/head consumers.

Keep ADR-0016 private-first behavior: no public discovery files for private routes, no build-time `lastmod`, and no broad `webSpec` or certification engine.

## Operator Guidance

Run this after `ultramodern-public-web-simplify-01-cloudflare-proof` or independently if only generator code is touched. Keep the diff mechanical and reviewable. Prefer moving code plus adding focused helper names over redesigning behavior. If the extraction becomes broad, stop at the seam definition and split follow-up implementation.
