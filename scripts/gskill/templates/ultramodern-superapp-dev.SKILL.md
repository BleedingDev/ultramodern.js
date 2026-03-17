---
name: ultramodern-superapp-dev
description: Enterprise app-development playbook for UltraModern.js host/remote super-apps. Use when agents create or modify MF host/remote apps, Effect API contracts, TanStack routes, trace propagation, and integration test scaffolding.
---

# UltraModern Super-App Development

## Architecture Anchors

- Reference target architecture first:
  - `docs/super-app-rfc-adr/ARCH-0001-effect-tanstack-target-architecture.md`
  - `docs/super-app-rfc-adr/BASELINE-0001-current-vs-target-contracts.md`
- Core architecture phrases to preserve:
  - `requestId-scoped`
  - `fallback telemetry`
  - `App-level MF SSR`
  - `Release promotion requires telemetry + contract gate success`
- Preserve independently deployable module boundaries.
- Keep host and remote contracts explicit, typed, and test-covered.

## Host and Remote Scaffolding Map

- Host:
  - `tests/integration/routes-tanstack-mf/mf-host/modern.config.ts`
  - `tests/integration/routes-tanstack-mf/mf-host/module-federation.config.ts`
  - `tests/integration/routes-tanstack-mf/mf-host/src/modern.runtime.tsx`
  - `tests/integration/routes-tanstack-mf/mf-host/src/routes/layout.tsx`
- Remote:
  - `tests/integration/routes-tanstack-mf/mf-remote/modern.config.ts`
  - `tests/integration/routes-tanstack-mf/mf-remote/module-federation.config.ts`
  - `tests/integration/routes-tanstack-mf/mf-remote/src/components/Widget.tsx`
  - `tests/integration/routes-tanstack-mf/mf-remote/src/components/Mutator.tsx`

## Effect API and Trace Contracts

- Effect API schemas:
  - `tests/integration/routes-tanstack-mf/mf-host/shared/effect/api.ts`
  - `tests/integration/routes-tanstack-mf/mf-remote/shared/effect/api.ts`
- Preserve trace propagation:
  - `traceparent`
  - `x-operation-id`
  - `x-modernjs-bff-operation-context`
- Validate host API flow:
  - `tests/integration/routes-tanstack-mf/mf-host/api/effect/index.ts`

## Reliability and Type Gates

- Remote loader reliability:
  - `tests/integration/routes-tanstack-mf/test/remote-loader-reliability.test.ts`
  - `mf-manifest.json`
  - `mfv`
- Type contracts:
  - `tests/integration/routes-tanstack-mf/tests/tanstack-mf-contract.test.ts`
  - `@mf-types`
  - `tsconfig.typecheck.json`

## Fast Commands (proto-managed)

- `proto run pnpm -- test:framework -- integration/routes-tanstack-mf/test/index.test.ts --runInBand`
- `proto run pnpm -- test:framework -- integration/routes-tanstack-mf/test/remote-loader-reliability.test.ts --runInBand`
- `proto run pnpm -- test:framework -- integration/bff-effect/tests/index.test.ts --runInBand`

## Editing Discipline

1. Change one host/remote contract at a time.
2. Re-run the narrowest integration test immediately.
3. Keep module federation and type artifacts in sync before broad test runs.
