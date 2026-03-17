---
name: ultramodern-project-init
description: Codex-first startup skill for initializing UltraModern.js super-app projects with proto, baseline test loops, and scaffold templates.
---

# UltraModern Project Init (Codex)

## Codex Execution Order

1. Run `proto install`.
2. Run `proto run pnpm -- install`.
3. Validate base integration with `proto run pnpm -- test:framework -- integration/routes-tanstack-mf/test/index.test.ts --runInBand`.
4. Keep edits in small slices: one subsystem at a time, then rerun the smallest reproducing test.

## Project Bootstrap Assets

- `packages/toolkit/create/template/README.md`
- `packages/toolkit/create/template/modern.config.ts.handlebars`
- `packages/toolkit/create/template/package.json.handlebars`
- `packages/toolkit/create/template/tsconfig.json`
- `packages/toolkit/create/template/src/`
- `packages/toolkit/create/template/api/`
- `packages/toolkit/create/template/shared/`

## Scaffold Anchors

- Host foundation starts from:
  - `tests/integration/routes-tanstack-mf/mf-host/modern.config.ts`
  - `tests/integration/routes-tanstack-mf/mf-host/module-federation.config.ts`
- Remote foundation starts from:
  - `tests/integration/routes-tanstack-mf/mf-remote/modern.config.ts`
  - `tests/integration/routes-tanstack-mf/mf-remote/module-federation.config.ts`

## Init Guardrails

- Do not skip proto-managed install/test bootstrap.
- Keep initial routing and type checks green before feature expansion.
- Establish host/remote contracts before adding new remotes.
