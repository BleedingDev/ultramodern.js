---
name: ultramodern-rsdoctor-builder-output
overview: Extend the framework-owned builder RsDoctor surface so generated apps can request the RsDoctor brief JSON artifact required by rsdoctor-action without app-level bundlerChain shims.
todos:
  - id: add-output-config-type
    content: Add the narrow RsDoctor output config type needed for brief JSON action output while preserving boolean and enabled semantics.
    status: pending
  - id: wire-output-options
    content: Forward the configured output options to RsdoctorRspackPlugin only when RsDoctor is explicitly enabled.
    status: pending
  - id: cover-builder-behavior
    content: Add focused builder tests for default off behavior, disableClientServer preservation, and brief JSON output forwarding.
    status: pending
isProject: false
---

# ultramodern-rsdoctor-builder-output

## Execution Notes

Shared graph contract:

- Opt-in env remains `ULTRAMODERN_RSDOCTOR=true`.
- Generated shell artifact path is `apps/shell-super-app/dist/rsdoctor-data.json`.
- Builder config should expose a minimal option equivalent to `output: { mode: 'brief', options: { type: ['json'] } }`.
- AI is workflow-only and optional; builder code must not know about `AI_TOKEN` or `ai_model`.

This is the shared interface lane. It should make RsDoctor Action-compatible output available from the owning builder layer, not from generated app bundlerChain code.

## Ownership

In scope:

- `packages/cli/builder/src/rsdoctorConfig.ts`
- `packages/cli/builder/src/plugins/rsdoctor.ts`
- `packages/cli/builder/tests/rsdoctor.test.ts`

Out of scope:

- Generated workspace templates.
- GitHub Actions workflow templates.
- Generated docs and contract metadata.
- Any revival of `ultramodern-diagnostics.json`.

## Stop Condition

Stop when the builder can pass a brief JSON output option to `RsdoctorRspackPlugin`, existing opt-in semantics are unchanged, and focused tests cover the new option. If the plugin API does not support the expected shape, hand back the exact API mismatch instead of changing generated apps.

## Verification

Run the focused builder RsDoctor test lane, for example `pnpm --filter @modern-js/builder test -- rsdoctor.test.ts`, or record why the local command is unavailable.

