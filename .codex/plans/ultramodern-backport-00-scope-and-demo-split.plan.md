---
name: ultramodern-backport-00-scope-and-demo-split
overview: Establish the boundary between UltraModern.js framework capabilities and the Tractor Store showcase so backports improve scaffolding/runtime behavior without turning the Modern.js fork into a demo repository.
todos:
  - id: audit-current-generator-scope
    content: Audit the current UltraModern workspace generator and templates for Tractor Store specific content, demo-only assets, debug UI, and framework-level capabilities that should remain.
    status: completed
  - id: define-hardcore-scaffold-contract
    content: Define the vanilla UltraModern preset contract: easy to customize, i18n-ready, SSR-ready, Cloudflare-ready, CSS-isolated, vertical-oriented, and free of product-demo copy or assets.
    status: completed
  - id: classify-backport-candidates
    content: Classify each discovered change as framework backport, generated-app baseline, native debug feature, or external demo repository work.
    status: completed
  - id: prepare-demo-repo-handoff
    content: Write the extraction handoff for publishing the full Tractor Store showcase as a separate BleedingDev demo repository, including what must not be copied back into UltraModern.js.
    status: completed
  - id: lock-publishing-boundary
    content: Document that package publishing must run only through GitHub Actions trusted publishing and that framework pushes target the bleedingdev remote unless explicitly overridden.
    status: completed
isProject: false
---

# ultramodern-backport-00-scope-and-demo-split

## Execution Notes

This is the gate before touching implementation. The accepted direction is that UltraModern.js stays close to vanilla Modern.js and only adds reusable UltraModern capabilities. The Tractor Store rebuild can remain valuable, but it belongs in a separate BleedingDev demo repository, not in the framework repository.

The scaffold should still be opinionated and feature rich. "Vanilla" here means a clean starter for real projects, not a minimal blank app. It should include the UltraModern preset, vertical-oriented structure, SSR, i18n, Cloudflare deploy readiness, CSS isolation, and native debug hooks where appropriate.

## Constraints

Do not backport Tractor Store product copy, product data, images, recommendations, routes, visual branding, or demo-specific BFF behavior into the framework. Do not preserve legacy "remote" terminology or compatibility shims when the clean current term is "vertical". Do not publish packages manually.

## Operator Guidance

Run this lane first. The classification output decides what the later lanes are allowed to change. Treat any uncertain item as demo-only until there is a reusable framework reason to keep it.
