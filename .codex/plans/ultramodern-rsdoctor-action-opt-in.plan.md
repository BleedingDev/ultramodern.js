---
name: ultramodern-rsdoctor-action-opt-in
overview: Add low-impact RsDoctor bundle analysis to generated UltraModern workspaces by keeping normal builds fast, enabling RsDoctor only in a dedicated GitHub Actions path, and documenting optional AI-assisted analysis without requiring secrets or making AI output a gate.
todos:
  - id: extend-rsdoctor-config
    content: Extend the framework-owned RsDoctor config surface to support deterministic brief JSON output and a stable report path without requiring generated apps to add bundlerChain shims.
    status: pending
  - id: verify-rsdoctor-output
    content: Add builder tests that prove opt-in RsDoctor still defaults off, preserves disableClientServer, and forwards brief JSON output options to RsdoctorRspackPlugin.
    status: pending
  - id: add-template-script
    content: Add a generated root script that builds the shell with ULTRAMODERN_RSDOCTOR=true for bundle analysis while leaving the normal build/check workflow unchanged.
    status: pending
  - id: add-template-workflow
    content: Add a dedicated generated GitHub Actions workflow for RsDoctor bundle analysis on pull_request, push, and workflow_dispatch using pinned actions, dynamic target branch comparison, minimal write permissions only on the analysis job, and no pull_request_target.
    status: pending
  - id: document-ai-opt-in
    content: Document RsDoctor Action setup, first-run baseline behavior, optional AI_TOKEN and ai_model configuration, fork-secret limitations, privacy guidance, and the non-gating nature of AI summaries in generated workspace docs.
    status: pending
  - id: update-template-contract
    content: Update generated UltraModern contract metadata to describe RsDoctor as opt-in CI bundle analysis, separate from default-on performance readiness diagnostics.
    status: pending
  - id: add-generator-tests
    content: Add generator/integration assertions that the workflow, scripts, docs, and contract metadata are emitted with the expected low-impact defaults and optional AI wiring.
    status: pending
  - id: run-validation
    content: Run focused builder tests, create/template integration tests, workflow lint where available, and the relevant repository quality gates before committing.
    status: pending
isProject: false
---

# ultramodern-rsdoctor-action-opt-in

## Execution Notes

The accepted direction is to give generated UltraModern workspaces the benefits of RsDoctor GitHub Action bundle diff analysis without returning to always-on RsDoctor builds or requiring AI usage. Current local evidence:

- Generated app config already has `performance.rsdoctor.enabled: process.env['ULTRAMODERN_RSDOCTOR'] === 'true'` and `disableClientServer: true`.
- Generated workspace CI currently runs format, lint, typecheck, skills, i18n boundaries, contract, and build only; it does not call `rsdoctor-action`.
- `performance.rsdoctor` currently supports only `enabled` and `disableClientServer`, so the template cannot guarantee the JSON output required by `rsdoctor-action` without expanding the framework-owned config surface.
- The root repo has a benchmark-only RsDoctor Action workflow that configures brief JSON output in app-level bundlerChain; do not copy that app-level pattern into generated apps.

Official RsDoctor references:

- RsDoctor GitHub Action requires a generated JSON data file and supports PR diff, push baseline upload, and workflow_dispatch behavior.
- AI-assisted analysis is optional: pass `AI_TOKEN` and optionally `ai_model`; without `AI_TOKEN`, regular bundle diff still runs and AI is skipped.
- RsDoctor recommends gating the plugin because it increases build time.
- RsDoctor brief JSON output uses `output: { mode: 'brief', options: { type: ['json'] } }`; report data can include module/source/build details, so privacy guidance matters.

## Constraints

- Keep normal generated `pnpm build`, `pnpm check`, and existing workspace-gates behavior unchanged unless the dedicated analysis command is explicitly invoked.
- Do not make RsDoctor default-on in normal local or CI builds; ADR-0001 is reverted and ADR-0016 states RsDoctor remains separately opt-in.
- Do not revive `ultramodern-diagnostics.json` or the reverted DIAG-0001 artifact machinery.
- Do not add app-level bundlerChain shims, generated suppressions, or demo-only wrappers to make this work; the JSON output surface belongs in the owning builder/runtime tooling layer.
- Do not require AI secrets, fail CI when AI is skipped, or treat AI text as a blocking quality gate.
- Do not use `pull_request_target`; secrets must remain unavailable to untrusted fork PR code.
- Keep action permissions scoped: the default workflow can remain read-only, but the analysis job may request the write permissions required for PR comments and baseline artifacts.
- Prefer pinned action SHAs, matching existing generated workflow style.

## Operator Guidance

Implement in this order:

1. Start with the builder config surface and tests. A plausible shape is adding a narrow object option such as `performance.rsdoctor.output` or `performance.rsdoctor.action` that maps to `RsdoctorRspackPlugin` options for brief JSON output. Keep the existing boolean and `enabled` semantics intact.
2. Only after the builder can guarantee JSON output, add generated scripts and workflow. The analysis script should likely target the shell build first; multi-app/multi-vertical analysis can be deferred unless product direction explicitly requires a matrix.
3. Workflow should run a dedicated build command with `ULTRAMODERN_RSDOCTOR=true`, then call `web-infra-dev/rsdoctor-action` with the generated JSON path and dynamic target branch. Add optional `AI_TOKEN: ${{ secrets.AI_TOKEN }}` and an explicit `ai_model` default, but document that no secret is required.
4. Documentation should explain first-run baseline behavior, expected extra CI time, fork PR secret behavior, and privacy tradeoffs. Mention AI analysis prominently as optional, not default.
5. Tests should cover both source generation and behavior. At minimum: builder option forwarding; generated package script; generated workflow content; generated contract metadata; no changes to the normal workspace-gates matrix.
6. Suggested validation commands: targeted builder RsDoctor tests, create workspace manifest/integration tests that cover template output, `pnpm run lint`, `pnpm run check-dependencies`, `pnpm run lint:package-json`, `pnpm run check-changeset`, and any available workflow lint/actionlint check if workflow YAML changes are not purely handlebars text.

Use subagents only after this plan validates and if implementation is split into independent lanes. Good split points are builder config/tests, template workflow/scripts, and docs/contracts/tests.
