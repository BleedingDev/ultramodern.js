# Fork audit 2026-06-12 — remediation plan

Companion to `fork-audit-2026-06-12-findings.md` (241 confirmed findings, IDs `area#n`).
Scope rule: fork-added code only; for fork-modified upstream files the only allowed moves are shrinking divergence or fixing fork-added hunks. Never refactor vanilla Modern.js logic.

Branch: `ultracode/brutal-cleanup` (off `ultracode/fork-hardening` @ 93ae063cd2).
Validation target: `../tractor-store-vertical-demo-publish-clean` (verified to reference none of the surfaces deleted in Phase A2).

## Phase A — make the gates tell the truth, then the great deletion

### A1 — critical truth-gate and correctness fixes (parallel, disjoint)

- **CI gates are no-ops** (`ci-workflows#1`, `scripts-misc#1`): `scripts/prepare-root.mjs` exits 0 when `CI=true` while `type-check.yml` / `integration-test-*.yml` use `pnpm run prepare` as their build/type-check step. Fix: workflows call explicit `prepare-build` (like nightly), CI guard semantics documented.
- **Gates never trigger on fork branches** (`ci-workflows#2`): upstream-derived PR/push gates filter on `main`/`v2` only. Add `main-ultramodern` (+ `ultracode/**` PRs) to triggers; drop dead `ultramodern`/`v4` triggers (`ci-workflows#7`).
- **Dead test suites** (`tests-fork-suites#1`): bare `jest.setTimeout` throws under rstest in 3 fork suites — replace with `tests/utils/setSuiteTimeout`.
- **postcss double-apply** (`gap-1#1`): fork re-added postcssrc loading upstream deliberately removed; user postcss plugins run twice per file. Remove the re-add, keep the monorepo-resolution fix, snapshot test.
- **Published render artifact broken for edge RSC** (`gap-3#1`): `ssr.mjs` ships a baked-in MODULE_NOT_FOUND stub for `@modern-js/render/rsc-worker`. Fix rslib externals so the subpath resolves at runtime.
- **create `--vertical` scaffolds broken code** (`toolkit-create#1`): generated vertical page references undeclared `supportedLanguages`. Fix template + generator test.

### A2 — the great deletion (parallel deleters per family; shared-file wiring goes to a single reconciler afterwards)

Verified-dead clusters (each deleter re-verifies zero consumers before `git rm`):

- **D1** `packages/runtime/plugin-garfish` (entire package: no package.json, dep absent from lockfile, both halves target removed APIs — `plugin-garfish#1..7`) + `benchmark/runtime-resilience` (benchmarks hand-copied clones of the dead package's cachePolicy; gate can never fail — `xcut-dead-features#2`, `toolkit-docs-hygiene#5`) + app-tools `deploy.microFrontend.{runtimeDigest,integrity,attestation}` trust fields serving only the dead package (`plugin-garfish#9`, `app-tools-fork-lane#4`).
- **D2** prod-server zombie legacy harness (~1.2k LOC unbuildable `ModernServer` lane, `modernServerSplit.ts`, `runtimeFallbackWorkerLane.ts`) + `workerLane` config surface + `MODERN_RUNTIME_FALLBACK_WORKER_LANE` (`server-lane#1..2`, `server-runtime-extensions#1`, `xcut-dead-features#1`). Keep the live runtime-extensions lane; move its only-copy tests in-package (`server-lane#4`).
- **D3** `packages/server/plugin-koa` + `packages/server/plugin-express` zombie v2 BFF adapters (`server-lane#3`, `xcut-dead-features#3`).
- **D4** `packages/builder/` orphan v2-era cluster (957 lines, cannot compile — `gap-1#2`) + plugin-runtime `src/ssr/` dead scaffold incl. tsconfig exclude (`plugin-runtime-fork-lane#1`, `toolkit-docs-hygiene#2`) + `async_storage.server.worker.ts` (`toolkit-docs-hygiene#4`) + `moduleSdk.d.ts` (`toolkit-docs-hygiene#8`) + fix `@modern-js/types` dangling `export * from './babel'` (`toolkit-docs-hygiene#1`).
- **D5** SuperApp script theater: `scripts/superapp-k6` (5.2k lines, k6/autocannon installed nowhere, exits 0 — `scripts-superapp#1`), `scripts/superapp-load` (third load engine — `xcut-scripts-duplication#8`), `scripts/superapp-local-control-plane`, `scripts/ultramodern-preflight` + `scripts/ultramodern-contract-doctor` (fail every fresh workspace; duplicate generator tests — `scripts-ultramodern#1..2`, `xcut-concept-coherence#2`), `validate-harness-contract.js` (`scripts-superapp#4`).
- **D6** MV governance theater: `scripts/mv-zephyr-profile`, `scripts/mv-production-rollout`, `scripts/mv-ci-hardening`, `scripts/mv-lane-policy`, `scripts/wave0-mv-contracts` + workflows `mv-ci-hardening.yml`, `mv-lane-policy.yml` (`scripts-mv#1..8`, `xcut-concept-coherence#4`). Keep `mv-integration-pilot`'s reference-topology suite (`validate:mv-topology-smoke` is the one wired MV artifact) and delete its orphaned remainder.
- **D7** dead `ultramodern-*`/misc scripts: `ultramodern-version-switching`, `ultramodern-cloudflare-ssr-validation`, `ultramodern-zephyr-live-evidence`, `ultramodern-zephyr-ssr-upload` (verify), `ultramodern-publish/resolve-affected-packages.mjs`, `scripts/ai-capabilities` (MCP bridge speaks LSP framing; parity gate tautological — `scripts-misc#2..3`), `scripts/test-orchestrator` (no consumer), boundary-guards ownership/blast-radius module (~600 dead lines; keep the wired boundary-violations checker).
- **D8** `tests/integration/bff-effect-lambda-only` — port its single unique case into `bff-effect`, delete suite (`tests-fork-suites#7`).
- **D9** docs orphans: `packages/document/main-doc/` + `builder-doc/` unbuilt trees, `validate:main-doc-docs` root script (calls nonexistent `build:doc`), tracked `.codex/` artifacts, revert sandpack `web-app` template to upstream baseline content (`gap-2#5`, `gap-2#8`, `xcut-dead-features#5`, `toolkit-docs-hygiene#6`).

- **R — reconciler** (serial, after A1+A2): root `package.json` scripts, release-gate profiles (drop string-pins on deleted files — `plugin-garfish#8`, `gap-1#3`), `ultramodern-nightly.yml`/`superapp-certification.yml` steps, FORK-DIVERGENCE.md entries, ADR status updates (mark Retired: ADR-0009, ADR-0011 parity lane, ADR-0012 zephyr profile, PREFLIGHT-0001, DIAG-0001, ADOPTION/OPERATIONS MV-governance rows), `pnpm install` lockfile regen.

### A-barrier
`pnpm install` → `prepare-build` (affected) → `test:ut` → `tests: test:framework` (targeted suites) → remaining `validate:*` → biome. Commit per cluster or as one phase-A commit.

## Phase B — correctness & security fixes in live code (parallel by package)

- **runtime-extensions** (`server-runtime-extensions#3..6,8,10`; `xcut-security#1,6`): fallback-signal endpoint default-off + token auth + constant-time compare; honor `telemetry.slo`; MF CSS warmup TTL/invalidations; restore final flush/teardown; fix bare-specifier stateStore resolution; mfCache decision (rewire or delete with docs).
- **i18n** (`plugin-i18n-lane#1..5,8`): decode-safe `matchPathPattern`; `localisedUrls` no longer default-on with empty map; SSR backend loadPath consistency; react-i18next back to optional peer; `prefetch` prop honest.
- **BFF lane** (`bff-lane#1..7,11`): schemaHash hashes schemas; restore Upload client path; dedupe browser/node policy/identity/envelope into shared module; unify the two envelope systems; `defineEffectBff().client` typed honestly; effectClientGenerator emits typed client.
- **app-tools** (`app-tools-fork-lane#2,5,6,8,12`): CORS wildcard removed/configurable; baseline preset stops re-enabling RsDoctor (ADR-0001 revert respected, fixes `xcut-concept-coherence#6` prod-boot crash); resolveESMDependency via `import-meta-resolve` or proper resolver; react-router bridge alias fix; dead deps dropped.
- **plugin-tanstack** (`plugin-tanstack#1,5,7,8`): import router types/utils through the context seam (delete copies); fix generated-preamble absolute-redirect bug; fix `source.include` path computation; register.gen.d.ts i18n heuristic.
- **toolkit-create** (`toolkit-create#2..8`): remove sudo-git-install from create + generated postinstall; honor or remove `--workspace`; Effect client wires operationContext/traceparent/locale; offline-safe version resolution; single source for version pins.
- **CI security** (`ci-workflows#3,4,8,9,10,11`; `scripts-ultramodern#10`): re-pin actions to SHAs; permissions blocks everywhere; workflow_dispatch inputs via env; extend validate-github-workflows.mjs to all workflows (pinning + permissions checks); frozen lockfile for docs deploy.
- **server/render** (`gap-3#2,3,5`): rsc.worker.tsx imports shared handleAction instead of verbatim copy; server-utils tsgo resolution robust outside hoisted installs; import-specifier rewriting made AST/sourcemap-safe (or scoped).

## Phase C — consolidation (parallel where disjoint)

Status: completed in the current working tree on 2026-06-13; Phase D/E and the final validation barrier remain pending.

- **scripts/lib**: `node:util` parseArgs adoption (30 hand-rolled copies), one server-lifecycle kit, one writeJson, finish validation-kit port, artifact-schema promoted to scripts/lib (`xcut-scripts-duplication#1,2,6,7,9`).
- **Gate spine**: merge `module-certification-gates.yml` + `release-contract-gates.yml`; single nightly superapp encoding; drop tautological gate-snapshot self-check; root script surface pruned to wired entries (`ci-workflows#5,6`, `xcut-concept-coherence#1,5,7`, `scripts-misc#5,6,7`).
- **Test infra**: one file-lock util, build-once orchestration for shared fixtures, shared applyBaseConfig/type-test fixtures, fold superapp-erp into portfolio, drop `.js` shim mirrors, single tsgo typecheck lane (`tests-fork-suites#2,3,4,9,10,12,13`).
- **plugin-tanstack/runtime seam**: export-star with local shadows replaces the 100-name allowlists; plugin.tsx/plugin.node.tsx shared core; drop `@tanstack/*` hard deps from `@modern-js/runtime` (`plugin-tanstack#2,4`, `plugin-runtime-fork-lane#3`).
- **i18n path helpers**: one strip/resolve/re-prefix implementation with precompiled matchers (`plugin-i18n-lane#6`).

## Phase D — divergence-footprint shrink (serial-ish, upstream files)

- Move ~515 lines of fork config types from upstream `types/config/*` into runtime-extensions-owned declaration merging (`xcut-divergence-footprint#2`, `server-lane#5`).
- `head.ts` Helmet impl → fork-owned module; hydration/asset injection through the `scriptOrder.ts` seam; revert the 76%-whitespace requestHandler re-indent; split static.ts upstreamable half; restore `loaderFailureMode` public type (`xcut-divergence-footprint#3,4,5,8`, `plugin-runtime-fork-lane#5`).
- Ledger truth pass: add missing entries (builder lane, MF dist patches, path-to-regexp migration, .npmrc autoInstallPeers), fix wrong tsconfig entries, queue verified [U] fixes for upstream PRs (`gap-1#6`, `gap-4#1,4`, `toolkit-docs-hygiene#3`, `xcut-divergence-footprint#6,9`, `app-tools-fork-lane#13`).

## Phase E — docs truthfulness

- Fix `ultramodern` phantom binary across ~37 pages; rsdoctor default-on claims; `effectBff.client.*` examples; localisedUrls routing contract page; document `runtime status|fallback-signal`; finish or revert shell rebrand (`gap-2#1..4,6,7,9`, `gap-1#4`).

## Final barrier + demo validation

1. Full barrier: `test:ut`, `tests/` framework + superapp-contracts (×2 for flake), `validate:tsgo`, both release-gate profiles `--skip-commands`, `test:scripts`, `validate:security-workflows`, biome.
2. Demo: pnpm overrides in `tractor-store-vertical-demo-publish-clean` pointing the `@bleedingdev/modern-js-*` aliases at the locally built packages → install → `pnpm check` + `pnpm build` + dev smoke of shell + one vertical.
3. Updated FORK-DIVERGENCE.md, ADR statuses, changesets for behavior changes; br issues for deferred items.

Deferred (filed as br issues, too large/risky for this pass): create-generator template-literal → file-template migration (`toolkit-create#9`), full Helmet replacement decision (`plugin-runtime-fork-lane#2`), gate-spine redesign beyond workflow merge, superapp-portfolio fixture-catalog data model (`tests-fork-suites#4`), MF dist-patch upstreaming (`gap-4#1`).
