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

## Repository Contracts

- `Map<string`
- `realRequest`
- `domainMap`
- `requestId = 'default'`
- `scripts/release-gates/module-certification-profile.json`

- `process.env.NODE_ENV === 'production'`
- `isRsdoctorEnabled`
- `api.context.bundlerType !== 'rspack'`
- `.github/workflows/bun-superapp-smoke.yml`
- `proto run pnpm -- validate:bun-smoke`
- `ADR-0008-bun-superapp-smoke-gates.md`

- `failLoudStartup`
- `startupHealthCheck`
- `non-fatal`
- `ProducerClientNotInitializedError`
- `ProducerDomainNotConfiguredError`
- `packages/server/create-request/src/node.ts`

- `telemetry.canary.promote`
- `telemetry.canary.rollback`
- `maxUnhealthyExporters`

- `moduleFederationAppSSRAlpha`
- `process.env.MODERN_MF_APP_SSR_ALPHA`
- `packages/runtime/plugin-runtime/src/cli/ssr/index.ts`
- `scripts/release-gates/rc-contract-profile.json`
- `requiredFiles`
- `gateCommands`
- `change one behavior at a time`
- `packages/server/create-request/tests`
- `packages/server/prod-server/tests`

- `performance.rsdoctor`
- `ultramodern-diagnostics.json`
- `packages/builder/builder/src/plugins/performance.ts`

## Fast Triage

- `allowedHeaders`
- `resolveHeaders`
- `identityBinding`
- `node --test scripts/module-sdk-contracts/__tests__/validator.test.js`
- `node --test scripts/boundary-guards/__tests__/validator.test.js`
- `traceId`
- `spanId`
- `enabled`
- `Rspack`
- `scripts/boundary-guards/profile.json`
- `best-effort`
- `telemetry.queue.dropped`
- `server.telemetry.failLoudStartup = false`
- `configure`
- `setDomain`
- `requestId !== 'default'`
- `maxQueueUtilization`
- `maxTotalDropped`
- `requiredContractGates`
- `scripts/module-sdk-contracts/validate-module-sdk-contracts.js`
- `scripts/boundary-guards/check-boundary-violations.js`
- `scripts/release-gates/validate-release-candidate-gates.js`
- `server.ssrByEntries`
- `tests/integration/i18n/mf/test/app-level-ssr-serve.test.ts`
- `--profile`
- `--evidence-dir`
- `fail-fast`
- `fallback telemetry`
- `disableClientServer`
- `reportDir`
