---
name: ultramodern-core
description: Guidance for coding agents working in the UltraModern.js fork of Modern.js. Use for debugging, contract verification, and implementation tasks involving rsdoctor diagnostics, BFF producer requestId behavior, telemetry exporters, module federation SSR alpha wiring, and release/boundary guard scripts.
---
# UltraModern Core

## Fast Triage

1. Confirm whether the issue is in framework code, generated contracts, or docs.
2. Prefer a minimal reproduction, then run the narrowest test first.
3. Read source and tests together before patching.
4. Apply small edits and rerun only the affected checks.

- `maxQueueUtilization`
- `maxTotalDropped`
- `requiredContractGates`
- `CACHE_VERSION_QUERY_KEY = 'mfv'`
- `fallback telemetry`
- `scripts/release-gates/validate-release-candidate-gates.js`
- `--profile`
- `--evidence-dir`

- `allowedHeaders`
- `resolveHeaders`
- `identityBinding`
- `Schema.optional(Schema.String)`
- `tests/integration/routes-tanstack-mf/mf-host/api/effect/index.ts`

## High-Signal Files

- RsDoctor diagnostics contract: `packages/builder/builder/src/plugins/performance.ts`
- BFF request runtime: `packages/server/create-request/src/node.ts`
- Browser request runtime: `packages/server/create-request/src/browser.ts`
- SSR runtime CLI path: `packages/runtime/plugin-runtime/src/cli/ssr/index.ts`
- Server config types: `packages/server/core/src/types/config/server.ts`
- Telemetry plugin implementation: `packages/server/core/src/plugins/telemetry.ts`
- Prod-server telemetry startup: `packages/server/prod-server/src/server/index.ts`
- Host scaffold reference: `tests/integration/routes-tanstack-mf/mf-host/modern.config.ts`

## Working Rules

- Keep changes reviewable and isolated.
- Avoid broad refactors unless they are required by a failing contract.
- Prefer explicit contract checks over implicit behavior.
- Keep docs and tests aligned with runtime behavior.

## Command Playbook

- Unit tests: `proto run pnpm -- test:ut`
- Create-request tests: `proto run pnpm -- test:ut -- packages/server/create-request`
- Prod-server tests: `proto run pnpm -- test:ut -- packages/server/prod-server`
- Integration checks: `proto run pnpm -- test:framework`
- Contract checks:
  - `proto run pnpm -- validate:module-sdk-contracts`
  - `proto run pnpm -- validate:boundary-guards`
  - `proto run pnpm -- validate:rc-gates`

## Repository Contracts

- BFF producer isolation is keyed by `requestId` and guarded by explicit runtime errors.
- Telemetry supports OTLP and VictoriaMetrics exporters.
- App-level MF SSR alpha behavior is controlled via `moduleFederationAppSSRAlpha`.

- `telemetry.canary.promote`
- `telemetry.canary.rollback`
- `maxUnhealthyExporters`
- `tests/integration/routes-tanstack-mf/test/remote-loader-reliability.test.ts`
- `mf-manifest.json`
- `mfv`
- `scripts/release-gates/rc-contract-profile.json`
- `requiredFiles`
- `gateCommands`

- `Map<string`
- `realRequest`
- `domainMap`
- `requestId = 'default'`
- `tests/integration/routes-tanstack-mf/mf-host/shared/effect/api.ts`
- `tests/integration/routes-tanstack-mf/mf-remote/shared/effect/api.ts`
- `traceparent`

## Debugging Checklist

- For build issues, inspect diagnostics artifact paths and rsdoctor mode/enablement logic.
- For producer API failures, verify `configure` call order, `requestId`, and domain setup.
- For telemetry drift, verify exporter enablement, queue size, and dropped envelope counters.
- For MF SSR issues, verify env wiring and alpha switch in both host and remote app configs.
