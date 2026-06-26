---
name: ultramodern-rsdoctor-docs-contract
overview: Document the opt-in RsDoctor Action path, optional AI analysis, and generated contract metadata while keeping RsDoctor separate from default-on performance readiness diagnostics.
todos:
  - id: update-generated-contract
    content: Describe RsDoctor as opt-in CI bundle analysis with its script, workflow, artifact path, and env trigger.
    status: pending
  - id: document-action-setup
    content: Document baseline behavior, extra CI cost, fork secret limitations, privacy guidance, and optional AI analysis.
    status: pending
  - id: keep-performance-readiness-separate
    content: Make the docs and contract text clear that default-on performance readiness remains separate from opt-in RsDoctor.
    status: pending
isProject: false
---

# ultramodern-rsdoctor-docs-contract

## Execution Notes

Shared graph contract:

- RsDoctor Action is opt-in CI bundle analysis, not a default normal-build diagnostic.
- Optional AI is documented prominently but is not required, not default-forced, and not a blocking quality gate.
- Privacy guidance should mention report contents and safe minimization choices.
- Fork PRs may not receive secret-backed AI summaries because secrets are unavailable to untrusted PR code.

Use the existing ADR stance as the boundary: ADR-0001 and DIAG-0001 are reverted, and ADR-0016 keeps RsDoctor separately opt-in.

## Ownership

In scope:

- `packages/toolkit/create/src/ultramodern-workspace/contracts.ts`
- `packages/toolkit/create/template-workspace/README.md.handlebars`
- `packages/document/docs/en/guides/get-started/ultramodern.mdx`
- Closely related generated contract docs if they already mention RsDoctor readiness.

Out of scope:

- Builder source.
- Workflow template implementation.
- Generated package scripts.
- Generated validator script and generator tests.

## Stop Condition

Stop when generated contract metadata and docs describe the RsDoctor Action path accurately, include optional AI analysis and its risks, and do not imply RsDoctor is always-on or required.

## Verification

Search edited docs for stale claims such as default-on RsDoctor, required AI usage, or revived `ultramodern-diagnostics.json`.

