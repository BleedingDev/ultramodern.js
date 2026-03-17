---
name: ultramodern-tanstack-routing-types
description: Codex routing and type-safety playbook for TanStack Router + Module Federation contracts in UltraModern.js.
---

# UltraModern TanStack Routing + Type Safety (Codex)

## TanStack Router Anchors

- `TanStack Router`
- `tests/integration/routes-tanstack-mf/mf-host/src/routes/layout.tsx`
- `tests/integration/routes-tanstack-mf/mf-host/src/routes/page.tsx`
- `tests/integration/routes-tanstack-mf/mf-remote/src/routes/page.tsx`
- `tests/integration/routes-tanstack-mf/test/index.test.ts`

## Type Contract Gates

- `tests/integration/routes-tanstack-mf/tests/tanstack-mf-contract.test.ts`
- `tsconfig.typecheck.json`
- `@mf-types`
- `src/type-tests`
- `runtime-shim`

## Module SDK Type Contracts

- `proto run pnpm -- validate:module-sdk-contracts`
- `docs/super-app-rfc-adr/contracts/module-sdk-contracts.json`
- `docs/super-app-rfc-adr/contracts/module-manifest.example.json`
- `scripts/module-sdk-contracts/validate-module-sdk-contracts.js`
- `packages/toolkit/types/common/moduleSdk.d.ts`

## Working Rules

- Do not ship MF route changes without type-contract and route-contract coverage.
- Keep host/remote route interfaces explicit and backward compatible.
- Validate type and SDK contracts before RC gate checks.
