---
name: ultramodern-rsdoctor-generated-config
overview: Update generated UltraModern app config to request deterministic RsDoctor brief JSON output only when the existing ULTRAMODERN_RSDOCTOR opt-in is enabled.
todos:
  - id: update-shell-rsdoctor-config
    content: Add the planned brief JSON output option to generated shell Modern config while keeping normal builds default off.
    status: pending
  - id: keep-generated-apps-shim-free
    content: Confirm the generated config uses native performance.rsdoctor options and does not add bundlerChain or click-through shims.
    status: pending
isProject: false
---

# ultramodern-rsdoctor-generated-config

## Execution Notes

Shared graph contract:

- Opt-in env remains `ULTRAMODERN_RSDOCTOR=true`.
- Generated shell artifact path is `apps/shell-super-app/dist/rsdoctor-data.json`.
- Generated app config should use the builder-owned `performance.rsdoctor` surface for brief JSON output.
- Normal generated `build`, `check`, and workspace gates must remain unchanged.

This lane can run in parallel with the builder lane because the graph has already fixed the intended config shape. Type-level integration is verified later after both lanes merge.

## Ownership

In scope:

- `packages/toolkit/create/src/ultramodern-workspace/module-federation.ts`

Out of scope:

- Builder source and builder tests.
- Package scripts and GitHub Actions workflow templates.
- Generated README/docs and contract metadata.
- Generator integration tests.

## Stop Condition

Stop when generated shell config requests RsDoctor brief JSON output under the existing opt-in env and still disables the RsDoctor client/server UI. If the config type is not yet available locally, keep the intended shape aligned with the shared graph contract and let final validation catch type drift.

## Verification

Run a focused create package type or unit test only if cheap. Otherwise report the changed config shape and defer full generator validation to the downstream test lane.

