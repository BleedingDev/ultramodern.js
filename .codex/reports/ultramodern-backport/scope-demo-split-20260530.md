# UltraModern Backport Scope Gate

Date: 2026-05-30
Graph: `ultramodern-backport-00-scope-and-demo-split-plus-4-plans-7b0f2758d5`
Bead: `modernjs-zvss`

## Decision

UltraModern.js must keep reusable framework and scaffold capabilities, but the Tractor Store product implementation is demo repository material. The framework generator must produce a neutral, easy-to-customize, feature-rich UltraModern starter, not a branded commerce application.

## Keep In UltraModern.js

- SSR plus Module Federation wiring: Modern.js SSR, manifest/remotes configuration, shared singleton configuration, and server-renderable route output.
- Route-owned i18n: localized route metadata, `localisedUrls`, locale-prefixed route generation, and native `@modern-js/plugin-i18n` integration.
- Tailwind v4 CSS isolation: per-app prefixes, `source(none)`, generated prefix contracts, shared design token CSS, and CSS federation metadata.
- Vertical terminology and tooling: shell plus full-stack verticals, add-vertical flow, topology updates, ownership metadata, and no legacy "remote" user-facing command path.
- Effect BFF/API scaffolding inside verticals: generated server entry, shared API contract, generated client, request-context propagation, and readiness/domain-operation metadata.
- Cloudflare deploy scaffolding: Modern.js Cloudflare preset integration, Worker names, public URL envs, proof routes, `cloudflare:*` scripts, and deploy proof tooling.
- Native debug boundary capability: framework-owned metadata and optional debugger UI, without app-specific overlay code.

## Move Or Remove From Framework Generator

- Tractor Store vertical identities: `explore`, `decide`, `checkout`, `tractor-*` teams, Slack/PagerDuty labels, and product-specific blast-radius metadata.
- Product-commerce routes: `/tractors`, `/stores`, `/cart`, `/checkout`, thank-you routes, Czech tractor/store path copy, and cart/product route semantics.
- Tractor assets and generated product visuals: `createCommerceAssetSvg`, `hero-field.svg`, tractor SVG variants, and product imagery.
- Branded shell and vertical UI: "Acre & Iron", "Field Loader 112", product comparison, store picker, prices, cart behavior, and recommendations.
- Tractor copy in locale files: product, cart, store, recommendation, and "Federated tractor commerce" text.
- Tractor-shaped Effect domain operations: cart, order, product detail, configuration, and recommendations. Keep the generic Effect machinery and replace operations with neutral baseline examples.
- Tractor-specific integration-test assertions. Tests in this repo should assert framework contracts; Tractor visual/product assertions belong in the separate demo repository.
- Stale static template content that still documents commerce/identity/design-system topology when the generator now owns neutral vertical scaffolding.

## Publishing Boundary

Publishing is only allowed through `.github/workflows/publish-bleedingdev.yml` with GitHub Actions trusted publishing. Local agents may run prepare, dry-run, validation, and affected-package selection commands, but must not run non-dry-run package publishing. Pushes target `bleedingdev` unless the user explicitly asks for upstream `origin`.

## Implementation Consequences

- `packages/toolkit/create/src/ultramodern-workspace.ts` is a single-writer hotspot until the generator is split or neutralized.
- `packages/toolkit/create/src/index.ts` is a single-writer hotspot for CLI and terminology changes.
- `.github/workflows/publish-bleedingdev.yml`, `scripts/ultramodern-publish/**`, and root `package.json` are single-writer hotspots for publishing/package work.
- `.codex/visual-compare-tractor/` is demo QA material and stays out of framework backport work unless explicitly promoted into the external demo repository.
