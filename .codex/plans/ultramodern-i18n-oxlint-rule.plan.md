---
name: ultramodern-i18n-oxlint-rule
overview: Replace generated regex i18n scanning with a source-backed Oxlint AST rule and shared runner that can be published and reused by generated apps and Tractor.
todos:
  - id: audit-checks-package-shape
    content: Audit packages/toolkit/ultramodern-checks and remove reliance on ignored dist-only artifacts; ensure the package has tracked source, package metadata, build scripts, and publish config.
    status: pending
  - id: define-rule-contract
    content: Define the exact AST rule contract for hardcoded JSX text, visible literal attributes, ignore comments, technical-token attributes, and TypeScript generic/effect helper non-regressions.
    status: pending
  - id: implement-oxlint-runner
    content: Implement the Oxlint-backed shared rule/runner exported as single-app and workspace check APIs without app-specific regex allowlists.
    status: pending
  - id: wire-generated-templates
    content: Update generated single-app and workspace templates so i18n checks call the shared package through stable wrapper scripts while preserving public script names.
    status: pending
  - id: add-regression-tests
    content: Add tests for real JSX copy violations, visible literal attributes, localized t(...) passes, ignore comments, technical-token elements, and TypeScript generic/effect helper false positives.
    status: pending
  - id: run-modern-gates
    content: Run focused create tests, ultramodern workspace tests, package build checks, check-dependencies, and diff hygiene for the Oxlint rule changes.
    status: pending
isProject: false
---

# ultramodern-i18n-oxlint-rule

## Execution Notes

Yes: `modernjs-9rcl` is the Oxlint AST scanner work. The wrapper may remain named `scripts/check-i18n-strings.mjs`, but the scanner must stop parsing TSX with regex. The owning implementation should live in a publishable `@modern-js/ultramodern-checks` package, not copied into generated apps.

The first task is deliberately a prefactor. The current checkout has `packages/toolkit/ultramodern-checks` with ignored `dist/` and `node_modules/` artifacts, so an implementation agent must first make the package source-backed and publishable before adding rule logic.

## Constraints

Do not add app-specific allowlist tokens. Do not remove Oxlint, oxfmt, or Ultracite from generated subprojects. Do not use `file:` or `link:` dependencies in generated install-strategy repositories. Keep script compatibility for `pnpm i18n:check` and `pnpm ultramodern:check`.

## Operator Guidance

This lane should complete before publishing the checks alias. Best subagent split: one agent audits package/publish shape, one implements AST rule semantics, one updates generated templates/tests. Integrate before running the broader create test slice.
