---
name: ultramodern-rsdoctor-template-ci
overview: Add a dedicated generated RsDoctor bundle analysis command and GitHub Actions workflow without altering the normal UltraModern workspace gates.
todos:
  - id: add-root-analysis-script
    content: Add a generated root script for shell bundle analysis that is invoked only by the dedicated RsDoctor workflow.
    status: pending
  - id: add-dedicated-workflow
    content: Add a separate generated GitHub Actions workflow using pinned actions, dynamic target branch comparison, and no pull_request_target.
    status: pending
  - id: wire-optional-ai-inputs
    content: Include optional AI_TOKEN and ai_model wiring without making secrets required or AI output gating.
    status: pending
isProject: false
---

# ultramodern-rsdoctor-template-ci

## Execution Notes

Shared graph contract:

- Workflow invokes the generated shell analysis build with `ULTRAMODERN_RSDOCTOR=true`.
- RsDoctor Action receives `file_path: apps/shell-super-app/dist/rsdoctor-data.json`.
- AI analysis is optional through `AI_TOKEN` and an explicit `ai_model`; absence of the secret must still leave bundle diff analysis useful.
- Do not use `pull_request_target`.

Prefer a new workflow such as `.github/workflows/ultramodern-rsdoctor-bundle-analysis.yml` so existing `ultramodern-workspace-gates.yml` remains focused on normal quality gates.

## Ownership

In scope:

- `packages/toolkit/create/src/ultramodern-workspace/package-json.ts`
- `packages/toolkit/create/template-workspace/.github/workflows/*.handlebars`

Out of scope:

- Builder internals.
- `module-federation.ts` RsDoctor config.
- Generated README/docs text.
- Contract metadata and generated validator assertions.
- Generator tests and snapshots.

## Stop Condition

Stop when generated workspaces have a dedicated command and workflow for RsDoctor bundle analysis, normal generated gates are untouched, and AI is wired as a non-required optional enhancement. If permissions required by `rsdoctor-action` are unclear, hand back the narrow permission question instead of widening all workflow permissions.

## Verification

Inspect generated workflow text for pinned actions, scoped permissions, dynamic target branch handling, optional AI inputs, and absence of `pull_request_target`.

