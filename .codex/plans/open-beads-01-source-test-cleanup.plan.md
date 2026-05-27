---
name: Open Beads 01 Source Test Cleanup
overview: Finish modernjs-fjk5 by replacing remaining UltraModern source-content assertions with structured generated metadata, config, build-output, and runtime behavior checks.
todos:
  - id: audit-current-source-assertions
    content: "Inventory remaining source-content assertions in create-ultramodern-workspace tests and related validators; classify each by behavior it intends to prove."
    status: completed
  - id: add-structured-readers
    content: "Add or reuse structured readers for package.json, pnpm-workspace.yaml, topology JSON, generated contract JSON, Module Federation config shape, and generated Modern config where practical."
    status: completed
  - id: refactor-generator-tests
    content: "Replace source-text assertions in the canonical UltraModern generator test with structured assertions and existing typecheck/build/runtime gates, preserving coverage for i18n, MF SSR, DTS, Effect BFF, Zephyr, Cloudflare, and package-manager policy."
    status: completed
  - id: update-validator-with-behavioral-contracts
    content: "Update generated validator or contract-doctor checks that still inspect source text so they assert structured artifacts, generated contract metadata, or build/runtime outputs instead."
    status: completed
  - id: run-cleanup-gates
    content: "Run the focused create-ultramodern-workspace tests, generated validator, typecheck gate, and formatting/lint checks needed to prove the replacement tests are equivalent or stronger."
    status: completed
  - id: close-source-test-bead
    content: "Update and close modernjs-fjk5 only after the source-content assertion audit is clean or remaining exceptions are documented as non-source behavioral checks."
    status: completed
isProject: true
---

# Open Beads 01 Source Test Cleanup

## Execution Notes

This plan owns `modernjs-fjk5`.

The goal is not to delete coverage. The goal is to make tests prove behavior and generated contracts instead of matching arbitrary source text.

Expected primary files:

- `tests/integration/create-ultramodern-workspace/tests/index.test.ts`
- `packages/toolkit/create/template-workspace/scripts/validate-ultramodern-workspace.mjs.handlebars`
- `packages/toolkit/create/src/ultramodern-workspace.ts` only if new generated metadata is needed
- existing contract-doctor or Zephyr profile validators only where they still use source-content checks for UltraModern behavior

## Constraints

Do not add source-code-content assertions, string grep tests, or near-equivalent checks against implementation text.

Do not weaken mandatory i18n, MF SSR, DTS, Effect BFF, Zephyr metadata, Cloudflare Worker output, or package-manager/toolchain coverage.

Do not refactor unrelated generator behavior.

## Operator Guidance

Prefer these proof surfaces:

- JSON metadata and generated contract files
- package scripts and dependency fields parsed as JSON
- topology and overlay JSON
- real typecheck output
- generated validator exit code
- built `.output` structure
- HTTP responses from local Worker validation when runtime proof is required
