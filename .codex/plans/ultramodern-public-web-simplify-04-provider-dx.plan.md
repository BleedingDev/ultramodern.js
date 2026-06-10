---
name: ultramodern-public-web-simplify-04-provider-dx
overview: Improve route-owned dynamic sitemap provider DX by making route.sitemap.mjs discovery and content source manifest generation framework-owned, while preserving the current explicit contentSources contract for compatibility.
todos:
  - id: document-current-provider-interface
    content: Document the current route-owned provider interface, including route.sitemap.mjs exports, UltramodernPublicSitemapEntry shape, localeParams behavior, draft/indexable filtering, and contentSources manifest requirements.
    status: pending
  - id: design-discovery-contract
    content: Design a build-safe discovery contract that finds route-owned route.sitemap.mjs providers without importing React page modules or CSS and emits the same contentSources manifest shape.
    status: pending
  - id: add-discovery-tests
    content: Add tests for provider discovery across static routes, dynamic routes, localized route folders, missing providers, malformed provider paths, and explicit contentSources compatibility.
    status: pending
  - id: implement-provider-discovery
    content: Implement provider discovery in the scaffold/generator so authors create route-owned provider files and do not hand-edit contentSources for normal cases.
    status: pending
  - id: update-generated-docs
    content: Update generated README or shared-contracts guidance with the simplified author workflow for dynamic public routes and sitemap entries.
    status: pending
  - id: validate-provider-dx
    content: Run create-ultramodern integration tests and a dynamic sitemap smoke test proving discovered providers generate localized sitemap, robots, and webmanifest output.
    status: pending
isProject: false
---

# ultramodern-public-web-simplify-04-provider-dx

## Execution Notes

The current implementation supports route-owned ESM providers, but the generated contract still exposes `contentSources` as the manifest wiring. That is acceptable as a compatibility layer, but it is not the best author interface. The desired author seam is the route-owned `route.sitemap.mjs` file beside route metadata.

This lane is partly DX improvement and partly maintenance improvement: discovery concentrates provider wiring in the framework implementation instead of making app authors understand generated manifest internals.

## Constraints

Do not import React page modules, route components, CSS, client code, or arbitrary app runtime code during config/build discovery. Keep provider modules ESM and Node-build-safe. Preserve the current `contentSources` contract as generated output or compatibility input. Preserve draft/indexable filtering, localeParams, sitemap field validation, duplicate URL checks, and no build-time `lastmod` stamping.

## Operator Guidance

Run after `ultramodern-public-web-simplify-02-generator-module`, because discovery belongs in the public web generator module. This lane may be larger than a pure refactor if it adds discovery behavior, so treat it as the last lane and keep explicit compatibility tests for existing `contentSources`.
