---
name: ultramodern-opinionated-defaults-02-public-surfaces
overview: Implement conservative private-first generated public surfaces for UltraModern workspaces by deriving robots, sitemap, manifest, security.txt, and optional llms/API catalog output only from explicit public/indexable route metadata or generated public starter/docs/help/product inputs.
todos:
  - id: inspect-public-surface-generation-points
    content: Inspect current UltraModern workspace generation, generated contract validation, and emitted route metadata to identify the smallest file-generation insertion points for robots.txt, sitemap.xml, app manifest, security.txt, optional llms.txt, and optional API catalog output.
    status: completed
  - id: define-public-input-contract
    content: Define the minimal public input contract on top of existing public/indexable/publicSurface/publicRoutes metadata, including title, description, canonical inference, locale alternates, stable or omitted sitemap lastmod, and explicit opt-out behavior without requiring owner/id/canonicalPath/structuredData from app authors.
    status: completed
  - id: implement-public-file-renderers
    content: Implement deterministic renderers for robots.txt, sitemap.xml, app manifest, security.txt, optional llms.txt, and optional API catalog data using publicRoutes and generated public starter/docs/help/product inputs only.
    status: completed
  - id: wire-generated-output
    content: Wire generated public files into the UltraModern workspace materialization path so private/auth/tenant/internal app routes emit no public discovery output by default while explicit generated public surfaces are included.
    status: completed
  - id: extend-generated-contract-validation
    content: Extend generated contract checks and integration assertions to prove private routes are absent, public/indexable routes are included, non-production output is noindex/disallow where owned, and all generated files are stable across repeated generation.
    status: completed
  - id: document-sane-defaults-boundary
    content: Update the relevant UltraModern docs or generated README notes to describe the private-first public surface defaults, opt-in public metadata, and deferred JSON-LD boundary without introducing a webSpec/profile engine.
    status: completed
isProject: false
---

# ultramodern-opinionated-defaults-02-public-surfaces

## Execution Notes

Beads issue: `modernjs-04jb`.

Accepted direction:

- App screens default private/non-indexable.
- Commit `e3afeee3e9` already prefactored `packages/toolkit/create/src/ultramodern-workspace.ts` so generated route-owned metadata defaults to `public=false`, `indexable=false`, and `publicSurface='private-app-screen'`, with a derived `publicRoutes` list.
- Generated workspace contract validation already asserts shell and vertical app screens remain private/non-indexable and that `publicRoutes` is empty by default.
- Publicness is opt-in for app routes and can be generated true only for explicit landing/docs/help/product starter routes or other generated public inputs.
- `sitemap` follows `index`.
- `/llms.txt` is useful only for public docs/help/product/API surfaces, not private dashboard screens.
- `security.txt` and app manifest output must not expose route, tenant, auth, ownership, or private API details. Emit either safe deterministic defaults or no file when required inputs are absent.
- Sitemap `lastmod` must be stable when reliable content or metadata modification time is available. If not reliable, omit `lastmod` instead of stamping build time.
- JSON-LD is out of scope and deferred to `modernjs-b5cb` and `modernjs-sddt`; do not add structured data in this plan.

## Constraints

- Do not expose private routes, auth routes, tenant URLs, user data, or internal APIs through generated files.
- Do not require app authors to fill owner, id, canonicalPath, or structuredData for normal app screens.
- Do not add a broad `webSpec`, profile, certification, or agent-readiness engine.
- Do not emit rich agent/MCP/A2A discovery by default.
- Do not add app-level shims, custom navigation wrappers, synthetic anchor handlers, generated suppressions, route wrappers, hook bypasses, or demo-only patches.
- Keep generated public surfaces deterministic and environment-aware.
- Keep edits in the owning generator/framework/template layer. Generated app code should continue using native Modern.js/router primitives directly.
- Non-production generated output should be noindex/disallow where the framework owns the response or generated file.

## Operator Guidance

Depends on `ultramodern-opinionated-defaults-00-contract`.

Recommended first frontier: start with `inspect-public-surface-generation-points` and do not implement new metadata until the existing generated route contract and output paths are mapped.

After inspection, prefer small reusable renderer functions over scattered template literals in generated app files. Renderer outputs should be sorted and newline-stable. Tests should compare full generated files or parsed structured output where practical, and they should run repeated generation to prove deterministic output.

This lane can run independently of security defaults as long as it only generates files from already-owned public metadata. Coordinate with resilience/i18n before finalizing localized sitemap and hreflang behavior. Use subagents only after this graph is valid, with one worker on generator/renderers and one worker on integration validation if parallel execution is needed.

## Codebase Research 2026-06-06

Use `packages/toolkit/create/src/ultramodern-workspace.ts` as the owning surface. The already-landed prefactor is the private-first route metadata model: generated routes default to `public=false`, `indexable=false`, `publicSurface='private-app-screen'`, and expose a derived `publicRoutes` list. Build public files from that derived list instead of adding a new profile/spec layer.

Start by mapping `createPublicRouteMetadata`, `workspaceAssetsForApp`, `createAppGeneratedContract`, `createWorkspaceValidationScript`, `writeApp`, `rewriteShellAppFiles`, `generateUltramodernWorkspace`, and `addUltramodernVertical`. `workspaceAssetsForApp` is currently the smallest obvious insertion point, but shell rewrites must also update public assets so adding a vertical cannot leave stale generated public files behind.

Prefer removal and consolidation while implementing: delete duplicated ad hoc output decisions if renderer helpers replace them, omit sitemap `lastmod` unless stable metadata exists, and omit optional discovery files rather than emitting empty or misleading private-app catalogs.
