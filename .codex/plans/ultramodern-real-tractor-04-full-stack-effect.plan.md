---
name: Ultramodern Real Tractor 04 Full Stack Effect Verticals
overview: Make each real Tractor vertical a full-stack package where UI, Effect services, BFF/API handlers, clients, request context, and deployment markers move together.
todos:
  - id: define-effect-ownership-per-vertical
    content: "Define which Effect APIs belong to Explore, Decide, and Checkout, including recommendations/store data, product/detail data, cart/order state, and health/readiness markers."
    status: completed
  - id: define-edge-and-node-runtimes
    content: "Define how each vertical's Effect BFF builds for Cloudflare edge today and keeps a Node/Zerops path later without forking package ownership."
    status: completed
  - id: define-request-context-propagation
    content: "Define propagation for locale, tenant, auth/session placeholder, traceparent, correlation id, environment selector, and vertical version id from shell to remote UI and BFF calls."
    status: completed
  - id: define-api-client-contracts
    content: "Define generated typed clients for cross-vertical and shell-to-vertical calls, including failure types, retry policy, and explicit boundary crossing metadata."
    status: completed
  - id: define-cart-state-model
    content: "Design Checkout-owned cart state with local SPA resilience, optional server-backed Effect persistence, clear cart, checkout, thanks/order confirmation, and version marker responses."
    status: completed
  - id: define-health-readiness
    content: "Define per-vertical health/readiness endpoints that prove the current package can serve MF assets, SSR route, translations, and Effect BFF with matching build/version identity."
    status: completed
  - id: define-effect-validation
    content: "Define local and deployed validation for each vertical's Effect endpoints, including skew detection between UI marker and BFF marker."
    status: completed
isProject: true
---

# Ultramodern Real Tractor 04 Full Stack Effect Verticals

## Execution Notes

The user requirement is one package per micro-vertical, including FE and BE. This plan must preserve that. Checkout is the clearest proof because its UI controls and cart/order API must be owned by the same deployable vertical package.

## Constraints

- Shared packages, common contracts, and design tokens are allowed, but they are not vertical ownership boundaries.
- Do not create separate `checkout-api` and `checkout-ui` ownership packages for the core vertical.
- Do not make Cloudflare the only runtime assumption; Cloudflare is the immediate deployment proof, Zerops/Node is the later long-running proof.

## Operator Guidance

Prefer Effect-first APIs. Hono or other adapters can exist only as explicit compatibility paths, not as the default architecture.

