---
name: ultramodern-rsdoctor-generated-validator
overview: Update the generated workspace self-validator so generated projects can prove the dedicated RsDoctor workflow, command, artifact path, and opt-in contract are present.
todos:
  - id: assert-analysis-files
    content: Add validator assertions for the RsDoctor workflow file and generated root analysis script.
    status: pending
  - id: assert-analysis-contract
    content: Add validator assertions for opt-in env, artifact path, and separation from performance readiness.
    status: pending
  - id: reject-forced-ai
    content: Assert the generated contract does not require AI secrets for the bundle analysis path.
    status: pending
isProject: false
---

# ultramodern-rsdoctor-generated-validator

## Execution Notes

Shared graph contract:

- Validator should prove the low-impact defaults, not run RsDoctor.
- It should confirm the dedicated workflow and command exist.
- It should confirm AI is optional and the standard performance readiness command remains separate.

This lane can run in parallel with source-generation lanes because the intended generated file names and contract fields are fixed by the graph contract. Final generator tests will catch drift if another lane changes names.

## Ownership

In scope:

- `packages/toolkit/create/templates/workspace-scripts/validate-ultramodern-workspace.mjs.handlebars`

Out of scope:

- Builder source.
- Template workflow implementation.
- Package script generation.
- Contract metadata source.
- Generator tests and snapshots.

## Stop Condition

Stop when the generated validator checks the dedicated RsDoctor Action surface and optional-AI contract without invoking networked tools or running RsDoctor itself.

## Verification

Run the cheapest unit or snapshot test that renders `validate-ultramodern-workspace.mjs`, or hand off to the downstream generator-test lane with exact expected assertions.

