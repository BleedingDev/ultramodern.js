---
name: ultramodern-mf-contracts
description: Guidance for UltraModern.js module federation SSR alpha contract, diagnostics artifacts, and boundary/release contract gates. Use when changing MF SSR flags, rsdoctor diagnostics behavior, or module-sdk contract validation workflows.
---

# UltraModern MF and Contracts

## MF SSR Alpha Contract

- Runtime wiring: `packages/runtime/plugin-runtime/src/cli/ssr/index.ts`
- Config type surface: `packages/server/core/src/types/config/server.ts`
- Flag: `server.ssr.moduleFederationAppSSRAlpha` (also under `server.ssrByEntries`)
- Env define: `process.env.MODERN_MF_APP_SSR_ALPHA`
- Guardrail: current v4 behavior is contract/env wiring only.
- Guardrail (exact): `full app-level Module Federation SSR runtime bridge is still an alpha rollout item`.

## RsDoctor Diagnostics Contract

- Source: `packages/builder/builder/src/plugins/performance.ts`
- Contract file: `.rsdoctor/ultramodern-diagnostics.json`
- Manifest pointer: `.rsdoctor/manifest.json`
- Keep compatibility with `performance.rsdoctor` defaults and options.

## Canonical V4 Docs and SDK Contracts

- Canonical v4 doc:
  - `packages/document/main-doc/docs/en/guides/get-started/ultramodern.mdx`
  - `canonical V4 reference`
  - `Complete Difference Matrix`
- SDK type contract:
  - `packages/toolkit/types/common/moduleSdk.d.ts`

## Boundary and Release Gates

- Module SDK contract validator:
  - `scripts/module-sdk-contracts/validate-module-sdk-contracts.js`
  - `docs/super-app-rfc-adr/contracts/module-sdk-contracts.json`
  - `docs/super-app-rfc-adr/contracts/module-manifest.example.json`
- Boundary anti-pattern checks:
  - `scripts/boundary-guards/check-boundary-violations.js`
  - `scripts/boundary-guards/profile.json`
- Release candidate gates:
  - `scripts/release-gates/validate-release-candidate-gates.js`
  - `scripts/release-gates/rc-contract-profile.json`
  - `scripts/release-gates/module-certification-profile.json`

## Commands

- `proto run pnpm -- validate:module-sdk-contracts`
- `proto run pnpm -- validate:boundary-guards`
- `proto run pnpm -- validate:module-certification-gates`
- `proto run pnpm -- validate:rc-gates`

## Test and Docs Anchors

- MF integration tests:
  - `tests/integration/i18n/mf/test/index.test.ts`
  - `tests/integration/i18n/mf/test/app-level-ssr-serve.test.ts`
- Canonical v4 diff docs:
  - `packages/document/main-doc/docs/en/guides/get-started/ultramodern.mdx`
