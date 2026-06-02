# TanStack Fast Defaults + Rsbuild Alignment Subagent Graph

Status: prepared only; no agents launched.

## Handoff Bundle

- plan selection:
  - `.codex/plans/ultramodern-tanstack-fast-defaults-01-router-runtime.plan.md`
  - `.codex/plans/ultramodern-tanstack-fast-defaults-02-search-contracts.plan.md`
  - `.codex/plans/ultramodern-tanstack-fast-defaults-03-scaffold-render-budget.plan.md`
  - `.codex/plans/ultramodern-tanstack-fast-defaults-04-rsbuild-start-alignment.plan.md`
- Rsbuild alignment expansion:
  - The four-plan graph snapshot is prepared at the state dir below; no agents have been launched.
- explicit plan edges:
  - `ultramodern-tanstack-fast-defaults-01-router-runtime:ultramodern-tanstack-fast-defaults-02-search-contracts`
  - `ultramodern-tanstack-fast-defaults-01-router-runtime:ultramodern-tanstack-fast-defaults-03-scaffold-render-budget`
  - `ultramodern-tanstack-fast-defaults-04-rsbuild-start-alignment:ultramodern-tanstack-fast-defaults-03-scaffold-render-budget`
- graph id: `ultramodern-tanstack-fast-defaults-01-router-runtime-plus-3-plans-c1c0b9da41`
- selection hash: `c1c0b9da41`
- snapshot path: `.codex/plan-graphs/ultramodern-tanstack-fast-defaults-01-router-runtime-plus-3-plans-c1c0b9da41/snapshot.json`
- state dir: `.codex/plan-graphs/ultramodern-tanstack-fast-defaults-01-router-runtime-plus-3-plans-c1c0b9da41`
- resolved agent limits: `max_threads=50`, `max_depth=3`

## Goal

Execute the TanStack fast-defaults plan with high wall-clock parallelism while keeping shared router interfaces single-owner and avoiding app-level shims. The graph should make UltraModern's TanStack Router integration fast by default through framework/runtime/tooling changes, incorporate the TanStack Start Rsbuild adapter lessons where they fit Modern's Rsbuild/Rspack ownership model, then prove the behavior with focused unit, type, integration, scaffold, chunk-graph, and SSR asset checks.

## Launch Policy

- Do not launch agents until the operator explicitly starts execution.
- Use at most 9 concurrently active agents in the first implementation wave despite the configured `max_threads=50`; this leaves headroom for the primary agent and keeps merge review tractable.
- `max_depth=3` allows nested agents, but all planned nodes are leaf nodes. Tell spawned agents not to spawn subagents unless the root operator revises this graph.
- The primary agent owns integration, final conflict resolution, graph updates, Beads updates, and final verification.
- Every write-capable worker must be told: other agents may be editing nearby files; do not revert unrelated changes; respect the exact write scope.

## Critical Path

1. `runtime-contract-owner` defines the shared fast-default contract/helper.
2. Runtime implementation lanes apply that contract in client, SSR, and generated router code.
3. `start-rsbuild-implementation-scout` and `modern-rsbuild-surface-scout` run read-only in parallel and feed `rsbuild-profile-design-owner`.
4. Runtime verifier confirms the fast defaults are behaviorally visible and regression-safe.
5. Search contract write lanes can proceed after the generated-router/runtime ownership conflicts are clear.
6. Rsbuild route-splitting, manifest, import-boundary, RSC/MF, and scaffold-output decisions proceed only after the profile design names the contracts and owners.
7. Final integration and full quality gates run locally.

Read-only scouts for search, scaffold navigation, render-budget design, and version drift can run immediately because they do not write files.

## Conflict Hotspots

- `packages/runtime/plugin-tanstack/src/runtime/types.ts`: single owner `runtime-contract-owner`.
- `packages/runtime/plugin-tanstack/src/runtime/plugin.tsx`: single owner `client-runtime-defaults`.
- `packages/runtime/plugin-tanstack/src/runtime/plugin.node.tsx`: single owner `ssr-runtime-defaults`.
- `packages/runtime/plugin-tanstack/src/cli/tanstackTypes.ts`: initially owner `generated-router-defaults`; later owner `search-router-gen` after merge.
- `packages/runtime/plugin-tanstack/src/runtime/routeTree.ts`: owner `search-route-tree`.
- `packages/runtime/plugin-tanstack/src/cli/index.ts`: owner `tanstack-rspack-router-plugin` after the Rsbuild profile design.
- `packages/runtime/plugin-runtime/src/cli/ssr/index.ts`: owner `modern-rsbuild-environment-profile`; do not let separate RSC/MF workers patch it concurrently.
- `packages/runtime/plugin-runtime/src/router/cli/code/templates.ts`: owner `modern-route-chunk-compat` if existing Modern route splitting needs adjustment.
- `packages/toolkit/create/src/ultramodern-workspace.ts`: owner `workspace-scaffold-navigation`.
- `packages/toolkit/create/template/src/routes/[lang]/page.tsx.handlebars`: owner `single-app-template-navigation`.
- `packages/runtime/plugin-i18n/src/runtime/routerAdapter.tsx`: owner `i18n-adapter-selectors`.
- Rsbuild/Rspack manifest tests and generated config contract assertions: owner `rsbuild-manifest-verifier`.
- `pnpm-lock.yaml`, `packages/runtime/plugin-tanstack/package.json`, create version constants: owner `tanstack-version-drift`, launch late.

## Wave 1: Immediate Fan-Out

### runtime-contract-owner

- status: not launched
- mode: write-capable
- purpose: Define the shared fast-default router option contract and helper.
- dependencies: none
- ownership:
  - may edit `packages/runtime/plugin-tanstack/src/runtime/types.ts`
  - may add a small helper under `packages/runtime/plugin-tanstack/src/runtime/` if needed
  - may add helper-focused tests only if they do not require runtime createRouter mocking
- do not edit:
  - `plugin.tsx`
  - `plugin.node.tsx`
  - `tanstackTypes.ts`
  - `routeTree.ts`
  - create scaffold files
- output needed: exact exported type/helper name, default value, override semantics, and files changed.
- stop condition: stop after defining the contract; hand back if applying it requires touching runtime createRouter callers.

Suggested prompt:

```text
You are not alone in the codebase. Do not revert unrelated changes.
Implement only the shared fast-default TanStack router option contract/helper for UltraModern. Own only packages/runtime/plugin-tanstack/src/runtime/types.ts and, if necessary, one new small helper file under packages/runtime/plugin-tanstack/src/runtime/. Do not edit plugin.tsx, plugin.node.tsx, tanstackTypes.ts, routeTree.ts, scaffold files, package versions, or lockfiles.

Goal: expose a framework-owned default for defaultStructuralSharing that client, SSR, and generated router code can consume consistently, while allowing explicit router config override.

Return files changed, exported names, and any follow-up needed for downstream runtime callers.
```

### search-surface-scout

- status: not launched
- mode: read-only
- purpose: Find the exact route generation path where `validateSearch` and `loaderDeps` can enter TanStack routes.
- dependencies: none
- ownership: read-only over route generation/types.
- do not edit any files.
- output needed: source-to-runtime trace with file refs, recommended insertion points, and conflict risks for later search workers.
- stop condition: stop at a concrete trace and proposed write ownership; do not implement.

Suggested prompt:

```text
Read-only task. Do not edit files.
Trace how route module/config metadata becomes NestedRouteForCli/PageRoute/RouteObject and then TanStack createRoute options. Specifically find where validateSearch and loaderDeps could be represented and passed through without generated-file edits. Cite files/lines and name the minimal write scopes for later workers.
```

### scaffold-navigation-scout

- status: not launched
- mode: read-only
- purpose: Inventory generated UltraModern internal navigation that bypasses TanStack/i18n router primitives.
- dependencies: none
- ownership: read-only over create templates and i18n adapter.
- do not edit any files.
- output needed: exact files/locations with `window.location`, raw internal anchors, broad `useLocation`, and recommended split between scaffold workers.
- stop condition: stop at inventory and proposed tests; do not implement.

Suggested prompt:

```text
Read-only task. Do not edit files.
Inventory generated UltraModern TanStack navigation code that uses window.location, raw internal anchors, or broad useLocation subscriptions. Focus on packages/toolkit/create and packages/runtime/plugin-i18n. Return exact file refs, likely tests, and a split into disjoint write scopes.
```

### render-budget-scout

- status: not launched
- mode: read-only
- purpose: Design a render-budget fixture that catches unrelated shell/sidebar rerenders during search/navigation changes.
- dependencies: none
- ownership: read-only over integration tests and existing TanStack fixtures.
- do not edit any files.
- output needed: recommended fixture path, test mechanics, render counter strategy, and commands.
- stop condition: stop at executable test design; do not implement.

Suggested prompt:

```text
Read-only task. Do not edit files.
Design the smallest TanStack integration fixture/test that proves search/navigation updates do not rerender unrelated mounted shell panes. Reuse existing test patterns in tests/integration/routes-tanstack or superapp-portfolio. Return file paths to create/edit, render counter strategy, and exact test command.
```

### tanstack-version-drift-scout

- status: not launched
- mode: read-only
- purpose: Check current TanStack patch versions, compatibility notes, and lockfile impact before a late version bump.
- dependencies: none
- ownership: read-only over package metadata and upstream changelog/release notes.
- do not edit any files.
- output needed: whether to bump now, exact versions, risk notes, and affected files.
- stop condition: stop at recommendation; do not change package.json or lockfile.

Suggested prompt:

```text
Read-only task. Do not edit files.
Evaluate whether to bump @tanstack/react-router/@tanstack/router-core/@tanstack/history patch versions for this branch. Check local pinned versions, npm latest patch versions, and upstream release notes/issues if needed. Return exact recommended versions, risks, and files that the later version worker would own.
```

### start-rsbuild-implementation-scout

- status: not launched
- mode: read-only
- purpose: Map TanStack Start's first-class Rsbuild implementation from source and package exports.
- dependencies: none
- ownership: read-only over external package source/docs and local notes.
- do not edit any files.
- output needed: concise source map for `@tanstack/react-start/plugin/rsbuild` and `@tanstack/start-plugin-core/rsbuild`, including environment planning, router generator/code splitter, manifest capture, import protection, RSC layering, dev middleware, build ordering, and post-build hooks.
- stop condition: stop at evidence-backed recommendations; do not propose direct adoption without naming Modern compatibility risks.

Suggested prompt:

```text
Read-only task. Do not edit files.
Investigate TanStack Start's new Rsbuild support from the published packages and TanStack/router source. Map the rsbuild adapter files and summarize what UltraModern should borrow, avoid, or adapt. Focus on client/server environment planning, @tanstack/router-plugin/rspack registration, normalized client build manifests, import protection, RSC layers, MultiCompiler dependencies, and dev SSR middleware. Return file paths, package versions, and Modern.js compatibility risks.
```

### modern-rsbuild-surface-scout

- status: not launched
- mode: read-only
- purpose: Map UltraModern's current Rsbuild/Rspack integration surfaces and the places Start-inspired changes would need to land.
- dependencies: none
- ownership: read-only over `packages/runtime/plugin-tanstack`, `packages/runtime/plugin-runtime`, generated UltraModern config, Module Federation/Zephyr/Cloudflare contracts, and tests.
- do not edit any files.
- output needed: source-to-build trace for TanStack routes under Modern Rsbuild/Rspack, current `splitRouteChunks` behavior, SSR asset/bootstrap behavior, and exact future write scopes.
- stop condition: stop at write-scope recommendations and conflict risks.

Suggested prompt:

```text
Read-only task. Do not edit files.
Map UltraModern's current TanStack + Rsbuild/Rspack surfaces. Trace packages/runtime/plugin-tanstack, packages/runtime/plugin-runtime SSR, packages/runtime/plugin-runtime router code templates, generated UltraModern config, Module Federation SSR, Zephyr Rspack, and Cloudflare Worker SSR. Compare the current shape to TanStack Start's Rsbuild adapter patterns and return exact future owners, tests, and risks.
```

### rsbuild-performance-proof-scout

- status: not launched
- mode: read-only
- purpose: Define how to prove Rsbuild/Rspack changes actually make TanStack fast by default.
- dependencies: none
- ownership: read-only over integration tests, Rsdoctor config, generated app tests, and existing browser smoke patterns.
- do not edit any files.
- output needed: proposed proof matrix for Rspack chunk graph, SSR asset bootstrap, async route chunks, render budget, navigation timing, and Cloudflare/MF/Zephyr coexistence.
- stop condition: stop at commands and fixture recommendations.

Suggested prompt:

```text
Read-only task. Do not edit files.
Design the proof matrix for a future UltraModern TanStack Rsbuild profile. Include Rspack chunk graph assertions, manifest/SSR bootstrap checks, route navigation timing, render-count budgets from the Conductor-inspired plan, Rsdoctor diagnostics, and Cloudflare/MF/Zephyr smoke coverage. Return smallest useful tests and commands.
```

## Wave 2: Parallel Runtime And Scaffold Writes

Launch after `runtime-contract-owner` finishes and the primary agent reviews the exported helper/contract. The scaffold workers may also wait for their scout result if the operator wants that inventory first.

### client-runtime-defaults

- status: not launched
- mode: write-capable
- dependencies: `runtime-contract-owner`
- ownership:
  - `packages/runtime/plugin-tanstack/src/runtime/plugin.tsx`
  - client runtime tests if needed
- do not edit `plugin.node.tsx`, `tanstackTypes.ts`, `routeTree.ts`, or shared types/helper except by requesting a follow-up from the contract owner.
- output needed: patch applying fast defaults to browser `createRouter` while preserving cache/basepath/RSC behavior.
- verification: focused plugin-tanstack client/runtime tests or a mocked createRouter assertion.

### ssr-runtime-defaults

- status: not launched
- mode: write-capable
- dependencies: `runtime-contract-owner`
- ownership:
  - `packages/runtime/plugin-tanstack/src/runtime/plugin.node.tsx`
  - SSR runtime tests if needed
- do not edit `plugin.tsx`, `tanstackTypes.ts`, `routeTree.ts`, or shared types/helper.
- output needed: patch applying the same fast defaults to SSR `createRouter` while preserving `serverSsr`, loader timing, redirects, status, hydration scripts, and RSC navigation handling.
- verification: focused SSR/runtime tests or mocked createRouter assertion.

### generated-router-defaults

- status: not launched
- mode: write-capable
- dependencies: `runtime-contract-owner`
- ownership:
  - `packages/runtime/plugin-tanstack/src/cli/tanstackTypes.ts`
  - `packages/runtime/plugin-tanstack/tests/router/tanstackTypes.test.ts`
  - generated type snapshots/contracts only if regenerated by tests
- do not edit `routeTree.ts` or scaffold files.
- output needed: generated `router.gen.ts` includes the same fast defaults.
- verification: `pnpm --filter @modern-js/plugin-tanstack test -- --run tests/router/tanstackTypes.test.ts`

### workspace-scaffold-navigation

- status: not launched
- mode: write-capable
- dependencies: `scaffold-navigation-scout` preferred, but not strictly required
- ownership:
  - `packages/toolkit/create/src/ultramodern-workspace.ts`
  - create package tests that assert generated workspace output
- do not edit runtime plugin files or template single-app files.
- output needed: generated workspace shell language changes use router/i18n navigation primitives instead of `window.location.assign`, preserving localized paths and suffixes.
- verification: create package tests or fixture output assertions.

### single-app-template-navigation

- status: not launched
- mode: write-capable
- dependencies: `scaffold-navigation-scout` preferred, but not strictly required
- ownership:
  - `packages/toolkit/create/template/src/routes/[lang]/page.tsx.handlebars`
  - related create template tests
- do not edit `ultramodern-workspace.ts` or runtime plugin files.
- output needed: TanStack starter internal language links use router-aware primitives rather than raw anchors when router is available.
- verification: generated template assertion.

### i18n-adapter-selectors

- status: not launched
- mode: write-capable
- dependencies: `scaffold-navigation-scout` preferred
- ownership:
  - `packages/runtime/plugin-i18n/src/runtime/routerAdapter.tsx`
  - `packages/runtime/plugin-i18n/tests/routerAdapter.test.tsx`
- do not edit create templates or plugin-tanstack files.
- output needed: narrower TanStack location/params subscription strategy with stable snapshots or selectors where possible.
- verification: plugin-i18n router adapter tests plus a new regression for unchanged route data identity if practical.

## Wave 2B: Rsbuild Start Alignment

Launch after `start-rsbuild-implementation-scout`, `modern-rsbuild-surface-scout`, and `rsbuild-performance-proof-scout` return. These lanes prepare and then implement Start-inspired Rsbuild/Rspack improvements only after the primary agent accepts the profile design.

### rsbuild-profile-design-owner

- status: not launched
- mode: write-capable for planning/design docs only unless the operator explicitly expands scope
- dependencies:
  - `start-rsbuild-implementation-scout`
  - `modern-rsbuild-surface-scout`
  - `rsbuild-performance-proof-scout`
- ownership:
  - `.codex/plans/ultramodern-tanstack-fast-defaults-04-rsbuild-start-alignment.plan.md`
  - optional ADR/design note selected by the primary agent
- do not edit runtime/plugin/config implementation files.
- output needed: accepted UltraModern TanStack Rsbuild profile decision, including direct-use/adapt/avoid decision for `@tanstack/router-plugin/rspack`, manifest contract, environment contract, and test matrix.
- stop condition: stop before code changes; hand back if implementation ownership is unclear.

### tanstack-rspack-router-plugin

- status: not launched
- mode: write-capable
- dependencies:
  - `rsbuild-profile-design-owner`
  - `generated-router-defaults`
- ownership:
  - `packages/runtime/plugin-tanstack/src/cli/index.ts`
  - plugin-tanstack router generation/code-splitting tests
- do not edit `packages/runtime/plugin-runtime/src/cli/ssr/index.ts`, generated UltraModern config, or package versions.
- output needed: TanStack route generator/code-splitter wiring under Modern Rsbuild/Rspack according to the accepted profile, or a documented no-op if the design rejects direct Rspack plugin use.
- verification: focused plugin-tanstack generation tests plus an inspected Rspack plugin registration path.

### modern-rsbuild-environment-profile

- status: not launched
- mode: write-capable
- dependencies: `rsbuild-profile-design-owner`
- ownership:
  - `packages/runtime/plugin-runtime/src/cli/ssr/index.ts`
  - SSR/Rsbuild environment tests selected by the design owner
- do not edit plugin-tanstack route generation, generated UltraModern config, or lockfiles.
- output needed: Modern-owned client/server/worker environment behavior needed for TanStack fast defaults, including defines, server target/module format, RSC/MF/Cloudflare compatibility, and build-order constraints.
- verification: SSR plugin tests and config inspection for node, workerSSR, RSC, and Module Federation SSR cases.

### tanstack-rspack-manifest

- status: not launched
- mode: write-capable
- dependencies:
  - `rsbuild-profile-design-owner`
  - `tanstack-rspack-router-plugin`
  - `modern-rsbuild-environment-profile`
- ownership:
  - manifest/chunk graph utilities and tests named by the profile design
  - no implementation file ownership until the design names the manifest owner
- do not edit create scaffold or package versions.
- output needed: route-aware client build manifest or equivalent Modern integration that captures entry assets, async route chunks, static imports, dynamic imports, CSS, and HMR exclusions for SSR bootstrap/preload.
- verification: chunk graph assertions and SSR bootstrap asset assertions.

### tanstack-import-boundary-protection

- status: not launched
- mode: write-capable
- dependencies: `rsbuild-profile-design-owner`
- ownership:
  - import-boundary enforcement files named by the profile design
  - tests proving client/server leakage failures are framework-owned
- do not add app-level suppressions or generated-file edits.
- output needed: minimal Start-inspired import protection for UltraModern TanStack loaders/actions/BFF/RSC boundaries, or a documented decision that existing Modern boundaries already cover the risk.
- verification: negative tests for server-only imports entering client bundles and client-only imports entering server bundles when applicable.

### cloudflare-zephyr-rsbuild-verifier

- status: not launched
- mode: verification-only unless the primary explicitly promotes it
- dependencies:
  - `modern-rsbuild-environment-profile`
  - `tanstack-rspack-manifest`
- ownership: no writes except approved test fixtures.
- output needed: confirmation that the Rsbuild profile coexists with generated Cloudflare Worker SSR, Module Federation SSR, Zephyr Rspack, `assetPrefix`, `html.outputStructure`, and `splitRouteChunks` decisions.
- verification: generated config assertions plus the smallest deploy-target smoke matrix available locally.

## Wave 3: Search Contracts

Launch after `search-surface-scout` returns. Serialize any node touching `tanstackTypes.ts` behind `generated-router-defaults`.

### search-type-contracts

- status: not launched
- mode: write-capable
- dependencies: `search-surface-scout`
- ownership:
  - route metadata/type files identified by the scout
  - tests for those types
- do not edit `routeTree.ts`, `tanstackTypes.ts`, or runtime plugin createRouter callers.
- output needed: typed representation for `validateSearch`/`loaderDeps` that TanStack paths can consume and React Router paths can safely ignore.

### search-route-tree

- status: not launched
- mode: write-capable
- dependencies: `search-type-contracts`
- ownership:
  - `packages/runtime/plugin-tanstack/src/runtime/routeTree.ts`
  - `packages/runtime/plugin-tanstack/tests/router/routeTree.test.ts`
- do not edit `tanstackTypes.ts` until `generated-router-defaults` has merged.
- output needed: root and child routes pass search validators/deps through `createRootRoute`/`createRoute`.
- verification: routeTree tests proving validated search, SSR hydration behavior, and unchanged params/loader behavior.

### search-router-gen

- status: not launched
- mode: write-capable
- dependencies:
  - `search-type-contracts`
  - `generated-router-defaults`
- ownership:
  - `packages/runtime/plugin-tanstack/src/cli/tanstackTypes.ts`
  - `packages/runtime/plugin-tanstack/tests/router/tanstackTypes.test.ts`
  - type-test fixtures if required
- do not edit `routeTree.ts` or scaffold navigation files.
- output needed: generated router types import and emit search validators/deps while preserving existing loader/action import ordering and register augmentation.

### scaffold-search-example

- status: not launched
- mode: write-capable
- dependencies:
  - `search-route-tree`
  - `search-router-gen`
- ownership:
  - generated example route/template files selected by the operator after search implementation lands
  - related tests
- do not choose a schema library without checking dependency policy.
- output needed: small UltraModern-generated example of `validateSearch` plus route-bound/selector-based `useSearch`.

## Wave 4: Verification And Late Version Bump

### render-budget-fixture

- status: not launched
- mode: write-capable
- dependencies:
  - `render-budget-scout`
  - `client-runtime-defaults`
  - `generated-router-defaults`
- ownership:
  - one integration fixture/test path selected by scout
- do not edit runtime implementation files.
- output needed: render counter regression that fails if unrelated mounted shell panes rerender on search/navigation updates.

### tanstack-version-drift

- status: not launched
- mode: write-capable
- dependencies:
  - `tanstack-version-drift-scout`
  - `client-runtime-defaults`
  - `ssr-runtime-defaults`
  - `generated-router-defaults`
- ownership:
  - `packages/runtime/plugin-tanstack/package.json`
  - `packages/toolkit/create/src/index.ts`
  - `packages/toolkit/create/src/ultramodern-workspace.ts`
  - `packages/toolkit/create/template-workspace/pnpm-workspace.yaml`
  - `pnpm-lock.yaml`
- output needed: patch-version alignment only if scout recommends it and runtime tests pass before/after.
- verification: lockfile install/update command plus plugin-tanstack tests.

### final-integration-verifier

- status: not launched
- mode: verification-only
- dependencies: all write-capable implementation nodes
- ownership: no writes except test artifacts explicitly approved by primary.
- output needed: exact test matrix run, failures, and whether failures are in-scope or pre-existing.
- suggested commands:
  - `pnpm --filter @modern-js/plugin-tanstack test`
  - `pnpm --filter @modern-js/plugin-i18n test -- --run tests/routerAdapter.test.tsx`
  - relevant create package tests for generated workspace/template output
  - selected TanStack integration/browser render-budget tests

## Merge Points

1. After `runtime-contract-owner`: primary reviews exported contract and updates downstream prompts if names differ.
2. After Rsbuild scouts: primary decides whether `rsbuild-profile-design-owner` should remain design-only or whether implementation scope is ready.
3. After runtime trio (`client-runtime-defaults`, `ssr-runtime-defaults`, `generated-router-defaults`): primary runs focused plugin-tanstack tests before starting search write lanes that touch `tanstackTypes.ts`.
4. After `rsbuild-profile-design-owner`: primary freezes ownership for `plugin-runtime` SSR environment changes, `plugin-tanstack` Rspack route plugin wiring, manifest/chunk graph work, and generated config changes.
5. After scaffold navigation trio: primary verifies generated navigation semantics and resolves any i18n/runtime adapter mismatch.
6. After search trio: primary checks `routeTree.ts` and `tanstackTypes.ts` for duplicated helper logic or inconsistent search option handling.
7. Before `tanstack-version-drift`: primary confirms the implementation is green on current pinned versions.
8. Final: primary runs graph-level verification and updates plan todos/statuses.

## First Launch Command Shape

Use `multi_agent_v1.spawn_agent` only when execution is explicitly requested. Suggested first launch wave:

- `runtime-contract-owner` as `worker`
- `search-surface-scout` as `explorer`
- `scaffold-navigation-scout` as `explorer`
- `render-budget-scout` as `explorer`
- `tanstack-version-drift-scout` as `explorer`
- `start-rsbuild-implementation-scout` as `explorer`
- `modern-rsbuild-surface-scout` as `explorer`
- `rsbuild-performance-proof-scout` as `explorer`

Do not wait immediately after spawning unless the primary has no local integration work. The primary should prepare downstream prompts and review current runtime type surfaces while scouts run.
