---
name: ultramodern-rsdoctor-generator-tests
overview: Add generator and snapshot coverage after the source-generation lanes land so the emitted workflow, scripts, docs, contract metadata, and validator assertions stay consistent.
todos:
  - id: add-manifest-coverage
    content: Assert generated workspaces include the dedicated RsDoctor workflow and any new files in the manifest.
    status: pending
  - id: add-content-coverage
    content: Assert generated package scripts, workflow text, contract metadata, docs text, and validator checks match the low-impact opt-in contract.
    status: pending
  - id: refresh-focused-fixtures
    content: Refresh only the fixtures affected by the new generated files and validator text.
    status: pending
isProject: false
---

# ultramodern-rsdoctor-generator-tests

## Execution Notes

This lane starts after the write-capable generator lanes are integrated. It is intentionally downstream because tests need the final emitted file names and contract fields.

Inputs:

- `ultramodern-rsdoctor-generated-config`
- `ultramodern-rsdoctor-template-ci`
- `ultramodern-rsdoctor-docs-contract`
- `ultramodern-rsdoctor-generated-validator`

## Ownership

In scope:

- `packages/toolkit/create/tests/workspace-manifest.test.ts`
- `packages/toolkit/create/tests/workspace-content.test.ts`
- `packages/toolkit/create/tests/workspace-integration.test.ts`
- Focused fixture snapshots under `packages/toolkit/create/tests/fixtures/**` that change because of this feature.

Out of scope:

- Builder tests.
- Source-generation implementation files.
- Broad fixture churn unrelated to RsDoctor Action output.

## Stop Condition

Stop when generator tests cover the emitted RsDoctor Action surface and no unrelated snapshots or fixtures are updated. If source output is inconsistent, report the exact mismatch instead of patching implementation files in this lane.

## Verification

Run the focused create package tests that cover workspace manifest/content/integration output, or record the exact command that should be run after integration.

