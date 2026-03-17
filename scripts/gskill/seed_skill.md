---
name: ultramodern-core
description: Codex-oriented core skill for UltraModern.js covering project initialization, MF/MFE architecture, Effect BFF contracts, TanStack routing, and strict type-safety gates.
---

# UltraModern Core (Codex)

## Codex Startup Loop

1. Run `proto install`.
2. Run `proto run pnpm -- install`.
3. Start from fixture-backed host/remote scaffolds.
4. Change one subsystem at a time and rerun the smallest reproducing test.

## Project Init and Scaffold Anchors

- `packages/toolkit/create/template/README.md`
- `packages/toolkit/create/template/modern.config.ts.handlebars`
- `packages/toolkit/create/template/package.json.handlebars`
- `packages/toolkit/create/template/tsconfig.json`
- `packages/toolkit/create/template/src/`
- `packages/toolkit/create/template/api/`
- `packages/toolkit/create/template/shared/`
- `tests/integration/routes-tanstack-mf/mf-host/modern.config.ts`
- `tests/integration/routes-tanstack-mf/mf-remote/modern.config.ts`

## Module Federation + Micro Frontends

- `tests/integration/routes-tanstack-mf/mf-host/module-federation.config.ts`
- `tests/integration/routes-tanstack-mf/mf-host/src/modern.runtime.tsx`
- `tests/integration/routes-tanstack-mf/mf-remote/module-federation.config.ts`
- `tests/integration/routes-tanstack-mf/mf-remote/src/components/Widget.tsx`
- `tests/integration/routes-tanstack-mf/test/remote-loader-reliability.test.ts`
- `mf-manifest.json`
- `mfv`
- `CACHE_VERSION_QUERY_KEY = 'mfv'`

## BFF with Effect

- `tests/integration/routes-tanstack-mf/mf-host/shared/effect/api.ts`
- `tests/integration/routes-tanstack-mf/mf-host/api/effect/index.ts`
- `tests/integration/routes-tanstack-mf/mf-remote/shared/effect/api.ts`
- `Schema.optional(Schema.String)`
- `traceparent`
- `parseTraceparent`
- `x-operation-id`
- `x-modernjs-bff-operation-context`

## TanStack Routing and Type Safety

- `TanStack Router`
- `tests/integration/routes-tanstack-mf/mf-host/src/routes/layout.tsx`
- `tests/integration/routes-tanstack-mf/mf-host/src/routes/page.tsx`
- `tests/integration/routes-tanstack-mf/mf-remote/src/routes/page.tsx`
- `tests/integration/routes-tanstack-mf/tests/tanstack-mf-contract.test.ts`
- `tsconfig.typecheck.json`
- `@mf-types`
- `src/type-tests`
- `runtime-shim`
- `packages/toolkit/types/common/moduleSdk.d.ts`

## Command Playbook

- `proto run pnpm -- test:ut`
- `proto run pnpm -- test:framework -- integration/routes-tanstack-mf/test/index.test.ts --runInBand`
- `proto run pnpm -- test:framework -- integration/routes-tanstack-mf/test/remote-loader-reliability.test.ts --runInBand`
- `proto run pnpm -- test:framework -- integration/bff-effect/tests/index.test.ts --runInBand`
- `proto run pnpm -- validate:module-sdk-contracts`
- `proto run pnpm -- validate:boundary-guards`
- `proto run pnpm -- validate:rc-gates`
