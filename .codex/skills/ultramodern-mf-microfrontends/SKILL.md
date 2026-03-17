---
name: ultramodern-mf-microfrontends
description: Codex guidance for building Module Federation host/remote micro frontends in UltraModern.js with reliability and contract checks.
---

# UltraModern Module Federation + Micro Frontends (Codex)

## Host Scaffold

- `tests/integration/routes-tanstack-mf/mf-host/modern.config.ts`
- `tests/integration/routes-tanstack-mf/mf-host/module-federation.config.ts`
- `tests/integration/routes-tanstack-mf/mf-host/src/modern.runtime.tsx`
- `tests/integration/routes-tanstack-mf/mf-host/src/routes/layout.tsx`
- `tests/integration/routes-tanstack-mf/mf-host/src/routes/page.tsx`

## Remote Scaffold

- `tests/integration/routes-tanstack-mf/mf-remote/modern.config.ts`
- `tests/integration/routes-tanstack-mf/mf-remote/module-federation.config.ts`
- `tests/integration/routes-tanstack-mf/mf-remote/src/components/Widget.tsx`
- `tests/integration/routes-tanstack-mf/mf-remote/src/components/Mutator.tsx`
- `tests/integration/routes-tanstack-mf/mf-remote/src/routes/page.tsx`

## Reliability Contracts

- `tests/integration/routes-tanstack-mf/test/remote-loader-reliability.test.ts`
- `mf-manifest.json`
- `mfv`
- `CACHE_VERSION_QUERY_KEY = 'mfv'`
- `fallback telemetry`

## MF Runtime Guardrails

- Keep host/remote manifest and runtime wiring synchronized.
- Prefer explicit contract checks over implicit runtime assumptions.
- Re-run focused MF tests before broad framework suites.
