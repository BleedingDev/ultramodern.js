---
name: react-router-8-validation
overview: Prove the React Router 8 migration with dependency, type, unit, integration, generated app, SSR, RSC, and documentation coverage before closing modernjs-8854.
todos:
  - id: run-static-quality-gates
    content: Run formatting, lint, package-json lint, dependency checks, lockfile checks, and TypeScript validation for the migrated branch.
    status: pending
  - id: run-router-package-gates
    content: Run all affected runtime-utils, runtime, plugin-tanstack, app-tools, create, and plugin-ssg package tests.
    status: pending
  - id: run-react-router-integration-matrix
    content: Run representative React Router SSR, CSR, SSG, RSC, data loader, dev-server, entries, and error boundary integration suites.
    status: pending
  - id: run-tanstack-integration-matrix
    content: Run TanStack, TanStack module federation, and localized TanStack integration suites to prove the non-default router bridge still works.
    status: pending
  - id: run-generated-app-matrix
    content: Generate and validate UltraModern single-app and workspace variants for react-router and tanstack router modes.
    status: pending
  - id: run-docs-and-build-gates
    content: Run required package builds and docs build after dependency and runtime tests are green.
    status: pending
  - id: perform-final-source-audit
    content: Audit source, docs, package manifests, lockfile, and generated outputs for stale react-router-dom and v7-only references.
    status: pending
  - id: close-and-push
    content: Update modernjs-8854 with evidence, close it only if acceptance criteria are met, sync Beads, commit, rebase, push, and verify clean status.
    status: pending
isProject: false
---

# react-router-8-validation

## Execution Notes

This lane is downstream of all other React Router 8 migration lanes. It is intentionally heavy because the migration crosses package resolution, public router exports, SSR, RSC, generated workspaces, and CI baselines.

Minimum static and package gates:

- `pnpm install --lockfile-only`
- `pnpm check-dependencies`
- `pnpm lint:package-json`
- `pnpm lint`
- `git diff --check`
- `pnpm validate:tsgo`
- `pnpm --filter @modern-js/runtime-utils test`
- `pnpm --filter @modern-js/runtime test`
- `pnpm --filter @modern-js/plugin-tanstack test`
- `pnpm --filter @modern-js/app-tools test`
- `pnpm --filter @modern-js/create test`
- `pnpm --filter @modern-js/plugin-ssg test` if the package exposes a test script, otherwise run its router-related test files through the owning test config

Representative integration coverage to run or explicitly justify skipping:

- `pnpm --dir tests exec rstest run integration/routes/tests/index.test.ts`
- `pnpm --dir tests exec rstest run integration/routes/tests/routes-inspect.test.ts`
- `pnpm --dir tests exec rstest run integration/dev-server/tests/index.test.ts`
- `pnpm --dir tests exec rstest run integration/entries/tests/app-server-entry.test.ts`
- `pnpm --dir tests exec rstest run integration/ssr/tests/*.test.ts`
- `pnpm --dir tests exec rstest run integration/ssg/tests/*.test.ts`
- `pnpm --dir tests exec rstest run integration/rsc-csr-routes/tests/*.test.ts integration/rsc-ssr-routes/tests/*.test.ts`
- `pnpm --dir tests exec rstest run integration/routes-tanstack/tests/index.test.ts integration/routes-tanstack-create-routes/tests/*.test.ts`
- `pnpm --dir tests exec rstest run -c rstest.superapp-contracts.config.mts integration/routes-tanstack-mf/tests/tanstack-mf-contract.test.ts`
- `pnpm --dir tests exec rstest run integration/create-ultramodern-workspace/tests/index.test.ts`

## Constraints

Do not close `modernjs-8854` unless React Router packages are upgraded as a coherent compatible set, peer/dependency checks pass, and representative app/template checks pass without app-level shims.

If a gate is too slow or environment-dependent to run locally, record the exact command, why it was not run, and the replacement evidence. Do not silently omit SSR, RSC, or generated-app coverage.

Do not treat docs-only `react-router-dom` historical changelog references as failures. Do treat live docs, package manifests, generated templates, runtime source, app-tools aliases, and integration fixture package manifests as failures unless there is an explicit accepted blocker.

## Operator Guidance

Run validation in waves. Start with dependency/static gates, then package tests, then integration matrices, then builds/docs. This reduces noisy failures from stale lockfile or type issues.

Before final commit, capture these audit commands in the Beads issue notes:

- `npm view react-router version`
- `npm view react-router-dom version`
- `pnpm why react-router --recursive --depth 4`
- `pnpm why react-router-dom --recursive --depth 4`
- `rg -n "react-router-dom|hasErrorBoundary|future\\.v8|v8_middleware" ...` scoped to live source and docs

Use subagents only after this plan graph is valid. Good split points are dependency/platform, runtime behavior, templates/docs, and validation, with validation owned by the root agent or a dedicated verifier after all implementation lanes are merged.
