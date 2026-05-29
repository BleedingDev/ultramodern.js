---
name: Ultramodern Real Tractor 00 Boundary Contract
overview: Define the non-negotiable real Module Federation Tractor target for UltraModern: Explore, Decide, and Checkout are separate full-stack micro-vertical packages, not visual sub-boundaries inside one remote.
todos:
  - id: capture-canonical-ownership
    content: "Define the canonical Explore, Decide, and Checkout ownership matrix from Tractor references, including routes, exposed React surfaces, Effect API ownership, translations, CSS ownership, deploy identity, and runtime markers."
    status: completed
  - id: specify-vertical-manifest-schema
    content: "Design the generated full-stack vertical manifest schema that ties package name, MF name, exposes, routes, Effect endpoints, locale namespaces, CSS layers, Zephyr app identity, Cloudflare worker identity, version marker, owner, and blast-radius metadata into one contract."
    status: completed
  - id: define-cross-vertical-contracts
    content: "Define explicit contracts for Decide consuming Checkout AddToCart/MiniCart and Explore recommendations/header/footer through Module Federation, with typed event or Effect command boundaries where state crosses verticals."
    status: completed
  - id: define-version-marker-contract
    content: "Define a UI and API marker contract that makes version skew observable: each vertical version must expose matching UI marker, BFF marker, manifest marker, and deploy selector metadata."
    status: completed
  - id: define-css-contract
    content: "Define the CSS ownership contract for federated remotes: design tokens, shared base layers, remote-owned component CSS, CSS chunk loading, deduplication rules, and conflict prevention."
    status: completed
  - id: define-validation-contract
    content: "Define validation evidence required before claiming success: generated contracts, build outputs, HTTP SSR checks, MF manifest checks, Effect endpoint checks, browser composition checks, boundary overlay geometry, and no source-content assertions."
    status: completed
isProject: true
---

# Ultramodern Real Tractor 00 Boundary Contract

## Execution Notes

This is the foundation plan. It must reject the previous shortcut: one `remote-commerce` package with internal `explore` / `decide` / `checkout` labels is useful as a local visualizer, but it is not the architectural proof. The target is three real deployable vertical packages:

| Vertical | Owns | Must expose | May consume |
| --- | --- | --- | --- |
| `remote-explore` | home/listing/store picker/header/footer/recommendations | `./Header`, `./Footer`, `./Recommendations`, route entry, optional Explore Effect API | Checkout minicart if header displays cart |
| `remote-decide` | product detail, variant selection, product facts, detail route | `./ProductPage`, route entry, optional product Effect API | Explore recommendations, Checkout AddToCart/MiniCart |
| `remote-checkout` | AddToCart, MiniCart, cart, checkout, thanks/order confirmation, cart/order API | `./AddToCart`, `./MiniCart`, `./CartRoute`, `./CheckoutRoute`, route entry, Effect cart/order API | shared contracts/tokens only |

The contract must be generated and machine-readable. A human demo is not enough. The same vertical identity must be visible in:

- `package.json`
- `module-federation.config.ts`
- generated topology
- generated ownership metadata
- generated route metadata
- generated i18n namespace metadata
- generated Cloudflare worker output manifest
- Zephyr dependency metadata
- runtime UI/API marker responses

## Constraints

- Do not split FE and BE into separate ownership units for a vertical. A vertical package can contain UI, Effect services, BFF handlers, translations, and MF exposes.
- Do not model Explore/Decide/Checkout only as data attributes. Data attributes can visualize ownership, but package boundaries must be real.
- Do not use source-code string tests. Validate generated JSON, build artifacts, HTTP responses, browser behavior, and geometry.
- Keep the implementation as close as possible to vanilla Modern.js config surfaces: `appTools`, Modern.js plugins, Rspack config hooks, Module Federation config, i18n plugin, deploy config.

## Operator Guidance

Downstream plans must treat this file as the acceptance contract. If a later plan cannot point to a generated package boundary for Explore, Decide, and Checkout, it has not satisfied this program.

