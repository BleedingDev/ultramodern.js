---
name: Ultramodern Real Tractor 02 MF Composition Runtime
overview: Design and validate real Module Federation composition between Explore, Decide, Checkout, and the shell, including SSR, DTS, runtime fallback, cross-remote events, and mixed-bundler compatibility evidence.
todos:
  - id: define-exposes-and-remotes
    content: "Define exact MF exposes and remote consumption edges: Explore exposes Header/Footer/Recommendations, Decide exposes ProductPage and consumes Explore plus Checkout, Checkout exposes AddToCart/MiniCart/Cart/Checkout/Thanks, and shell consumes route entries."
    status: completed
  - id: define-ssr-composition
    content: "Define SSR behavior for shell and remote route rendering on Cloudflare workers, including request context, locale, trace context, remote manifest resolution, and deterministic CSR fallback when remote SSR fails."
    status: completed
  - id: keep-dts-mandatory
    content: "Define mandatory MF DTS settings and validation so `dts: false` is rejected by generated contract/build validation, while TypeScript package and native-preview checks both remain supported."
    status: completed
  - id: define-runtime-fallbacks
    content: "Design visible remote unavailable, incompatible version, missing manifest, and timeout fallback states for each remote boundary without crashing the shell or hydrating partial broken UI."
    status: completed
  - id: define-typed-domain-events
    content: "Design typed domain event helpers or Effect command boundaries for checkout:add-to-cart, checkout:cart-updated, checkout:remove-from-cart, checkout:clear-cart, explore:selected-store, and mf:navigate."
    status: completed
  - id: define-cross-bundler-lane
    content: "Define a compatibility lane that proves at least one non-Modern.js/Rspack remote can interoperate through standard Module Federation contracts without weakening the primary Modern.js path."
    status: completed
  - id: define-mf-observability
    content: "Define runtime diagnostics for resolved remote URL, remote version marker, manifest digest, load timing, fallback reason, and DTS/type mismatch reporting."
    status: completed
isProject: true
---

# Ultramodern Real Tractor 02 MF Composition Runtime

## Execution Notes

The target composition is remote-to-remote, not shell-only. Decide must render a product detail page that imports Checkout's `AddToCart` and Explore's `Recommendations` through MF. Checkout controls cart state. Explore owns listing/navigation/recommendation surfaces. Shell owns composition and environment selection.

SSR must remain a first-class requirement. If a remote cannot SSR, the shell must render a deterministic fallback boundary and then recover on the client where safe.

## Constraints

- Do not use direct source imports across vertical packages.
- Do not disable DTS.
- Do not couple remote composition to Zephyr-only behavior. Vanilla MF tooling must work locally; Zephyr is the asset/version layer.
- Do not let browser events become untyped string soup. Provide typed helpers/contracts.

## Operator Guidance

Implementation should start with the all-Modern.js path. Mixed bundler compatibility is a separate lane and must not compromise the generated default.

