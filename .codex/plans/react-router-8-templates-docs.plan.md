---
name: react-router-8-templates-docs
overview: Update generated apps, examples, documentation, tests, and changesets so React Router 8 is the documented and scaffolded package contract.
todos:
  - id: update-generated-workspace-versions
    content: Update create package version constants and generated package manifests so UltraModern React Router workspaces install React Router 8.
    status: pending
  - id: update-generated-router-imports
    content: Regenerate or edit owned templates and fixture expectations so generated apps import from react-router or react-router/dom as required by v8.
    status: pending
  - id: update-create-contract-tests
    content: Update create and integration tests that assert generated dependency pins, Node versions, package source manifests, and router template output.
    status: pending
  - id: update-app-tools-tests
    content: Update app-tools alias tests so they assert the v8 direct react-router path and no longer require a v7 react-router-dom fallback.
    status: pending
  - id: update-public-docs
    content: Update user-facing router docs and examples that mention react-router-dom or v7-only preparation language.
    status: pending
  - id: add-release-documentation
    content: Add changesets and migration notes for package consumers covering React Router 8, Node baseline, and import path expectations.
    status: pending
isProject: false
---

# react-router-8-templates-docs

## Execution Notes

This lane can begin after `react-router-8-baseline-dependencies` has selected the package versions, but it should not be finalized until `react-router-8-runtime-behavior` has settled the public import surface.

Primary local files and areas:

- `packages/toolkit/create/src/ultramodern-workspace/versions.ts`
- `packages/toolkit/create/src/ultramodern-workspace/package-json.ts`
- `packages/toolkit/create/tests/version-pins.test.ts`
- `tests/integration/create-ultramodern-workspace/tests/index.test.ts`
- `packages/solutions/app-tools/src/presetUltramodern.ts`
- `packages/solutions/app-tools/tests/presetUltramodern.test.ts`
- router docs under `packages/document/docs/**`
- relevant package README files and generated template comments
- `.changeset/*.md`

The previous preparation already moved owned generated UltraModern workspaces to direct `react-router` v7 pins. This lane changes the contract from preparation to adoption.

## Constraints

Do not edit historical changelog entries only because they mention `react-router-dom`; those are release history, not current docs. Do update live docs, generated templates, examples, and snapshots that describe current behavior.

Do not copy full UltraModern workspace policy into Sandpack examples. The project memory says Sandpack templates are browser documentation examples, not the owner for full generated repository policy.

Keep generated Node 26.3.0 policy intact unless the baseline lane deliberately changes it. React Router v8 only requires Node 22.22+, but generated UltraModern workspaces already target a newer baseline.

## Operator Guidance

Run template and docs-adjacent tests in addition to package unit tests:

- `pnpm --filter @modern-js/create test`
- `pnpm --filter @modern-js/app-tools test`
- targeted `tests/integration/create-ultramodern-workspace/tests/index.test.ts`
- `pnpm build:docs` only after package/runtime tests are green, because docs build is slower and can be affected by Rspress transitive dependencies

Every documentation change should answer what users should install, where DOM-specific imports come from, and what Node/React baseline is required. Keep the migration note concise and avoid documenting internal bridge details as user API.
