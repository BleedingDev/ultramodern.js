---
name: Ultramodern Real Tractor 03 Federated CSS
overview: Design the federated CSS strategy so real remotes avoid duplicated base styles, keep Tailwind effective, preserve SSR styling on Cloudflare, and prevent remote CSS collisions.
todos:
  - id: inventory-current-css-output
    content: "Inspect current Modern.js/Rspack CSS extraction output for shell and remotes, including SSR HTML links, async CSS chunks, remoteEntry-related assets, Tailwind output, and Cloudflare ASSETS serving behavior."
    status: completed
  - id: define-css-ownership-layers
    content: "Define CSS ownership layers: shared design tokens/base reset, shell layout chrome, remote-owned component styles, and route-level CSS chunks, with explicit rules for what may be shared versus duplicated."
    status: completed
  - id: define-tailwind-usage
    content: "Define Tailwind usage for generated remotes so Tailwind is available without per-page embedded CSS, with stable imports from layout or app entry and no generated source-content checks."
    status: completed
  - id: define-deduplication-mechanism
    content: "Design CSS deduplication for shared tokens/base layers using package boundaries, CSS layer names, content hashes, SSR link emission, and runtime chunk loading guarantees."
    status: completed
  - id: define-collision-prevention
    content: "Define collision prevention rules for remotes: CSS layers, optional scoping conventions, design-token variables, no global class leakage except approved base layer, and validation for conflicting layer names."
    status: completed
  - id: define-css-ssr-validation
    content: "Define validation that catches FOUC and missing remote CSS using HTTP SSR HTML inspection, browser screenshots, computed style checks, layout shift metrics, and async remote navigation checks."
    status: completed
  - id: define-css-version-switching
    content: "Define proof that switching a remote version also switches its remote-owned CSS while shared base CSS remains deduplicated and stable."
    status: completed
isProject: true
---

# Ultramodern Real Tractor 03 Federated CSS

## Execution Notes

This plan answers the CSS question directly. The desired result is not "each remote dumps all CSS and hope cache handles it." We need a layered contract:

1. shared tokens/base from shared design-system package or horizontal remote;
2. shell-owned layout chrome;
3. remote-owned component/route CSS emitted with that remote;
4. SSR links/chunks emitted so the first paint is styled;
5. runtime remote CSS loaded once per content hash.

Tailwind should be part of the generated app entry/layout path, not copied into every page. Remote CSS must survive Cloudflare Worker SSR and MF async loading.

## Constraints

- Do not inline CSS into every page.
- Do not accept FOUC as a cosmetic issue; it is a validation failure.
- Do not rely only on visual manual testing. Use computed style and layout shift checks.
- Do not centralize all remote CSS in the shell, because that destroys independent remote versioning.

## Operator Guidance

Start by measuring current emitted CSS before changing strategy. The implementation may need a Modern.js/Rspack helper in the generator, but avoid private runtime boot hacks.

