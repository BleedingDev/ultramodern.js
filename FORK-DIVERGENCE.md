# FORK-DIVERGENCE — modified upstream files ledger

Read this during every upstream sync. Merge-base: `8a744c1b` (v3.2.1), upstream = `origin` (web-infra-dev/modern.js).

Scope: upstream files **modified** by the fork, plus upstream files the fork **deleted** or **renamed** (appendices below — they conflict differently). This ledger has two scopes:

1. `packages/**` deltas, which are categorized by owning package below.
2. Root/infra deltas outside `packages/**` (CI, scripts, tests, docs, workspace policy, patches, changesets), summarized in the root/infra section because they are not package-owned but are still part of the upstream sync blast radius.

Regenerate the raw lists with rename detection pinned on (the counts depend on it; with `diff.renames=false` the 17 raw package renames surface as 17 D + 17 A and the M total shifts):

```sh
git diff -M 8a744c1b HEAD --name-status -- packages
git diff -M 8a744c1b HEAD --name-status -- . ':(exclude)packages/**'
```

`M` lines are the body of this ledger; `D`/`R` lines are the appendices; `A` lines are fork-owned files and usually summarized rather than listed exhaustively.

Fork-**added** files and packages (`@modern-js/plugin-tanstack`, `@modern-js/server-runtime-extensions` — `packages/server/runtime-extensions`, where the telemetry/contract-gate/MF-cache/MF-CSS server modules live — `app-tools/src/baseline.ts`, etc.) are fork-owned by definition and not listed here.

Legend:

- **[U]** upstreamable — a candidate to PR to web-infra-dev/modern.js in isolation.
- **[F]** permanent fork divergence — only meaningful with the ultramodern lanes (Effect BFF, TanStack, Module Federation SSR/topology evidence, telemetry, tsgo toolchain). Includes coupled dependency migrations where `package.json` and source must be taken from the same side.
- **[M]** mechanical — biome import re-sorting, `@effect-diagnostics` pragma headers (~73 of the 537 modified package files), tsconfig `rootDir`/`ignoreDeprecations`, package.json script/dep churn for the tsgo + rstest toolchain. Safe to take either side on conflict; prefer upstream content and re-run biome/pragma tooling.

Total at last audit (2026-06-13, post Phase A-C brutal-cleanup branch `ultracode/brutal-cleanup`):

- Raw package diff: 537 M, 335 A, 5 D, 17 R, total 894 paths.
- Ledger classification: 537 modified upstream files, 19 delete/template-move
  review items, 3 non-exact renames. The 14 exact `R100` moves from
  `packages/toolkit/create/template/**` to
  `packages/toolkit/sandpack-react/scripts/mwa-template/**` are treated as
  keep-deleted from their original upstream paths during merge review; the
  remaining three non-exact renames stay in Appendix B.
- root/infra outside `packages/**`: 835 paths changed from `8a744c1b` (`371 M`, `461 A`, `3 D`, `0 R`). These are mostly fork-owned additions, but the modified/deleted upstream files still conflict during sync and are summarized below.

---

## Root and infra scope (outside `packages/**`)

Root/infra is intentionally not package-owned, but it is not optional during upstream syncs. Treat these deltas as the repository policy layer for the fork.

### Workspace and dependency policy — [F]/[M]

- `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.npmrc`, `package.json`, `nx.json`, `biome.json`, `.gitignore`, `.mise.toml` — fork package manager, Renovate/security, tsgo/rstest/biome, and publish policy. Keep fork policy unless the upstream change is a pure package version/security update that can be re-expressed without undoing the fork's package-manager constraints.
- Root Renovate/security carve-outs already exist in `.github/renovate.json` and `pnpm-workspace.yaml` (`minimumReleaseAgeExclude`, Module Federation peer allowances, patched dependencies). Do not add app-level install shims to work around dependency policy.
- `patchedDependencies` applies Module Federation `2.8.0` patches to
  `@module-federation/{bridge-react,manifest,modern-js-v3,rspack}`; see
  `patches/README.md`.

### CI and GitHub workflows — mixed

- Added fork-owned workflows: `boundary-anti-patterns.yml`, `bun-superapp-smoke.yml`, `contract-gates.yml`, `docs-pages.yml`, `publish-bleedingdev.yml`, `superapp-certification.yml`, `ultramodern-nightly.yml`, `ultramodern-production-readiness.yml`, `workflow-security.yml`.
- Modified upstream workflows: dependency check, diff, integration tests, lint, type-check, unit tests, builder e2e, and issue labels. Reconcile upstream infrastructure fixes by hand; keep fork gates only where their scripts still exist.
- Deleted Phase A-C workflow names are intentionally not live: the old `.github/workflows/mv-*.yml` governance layer was removed with the dead script families in Appendix C. Do not cite those workflows as current evidence.

### Scripts and repo tooling — mixed

- Added fork-owned script families that remain live: `scripts/boundary-guards`, `scripts/ultramodern-boundary-check` (divergence guard, now wired into `validate:boundary-check` + `boundary-anti-patterns.yml`), `scripts/lib`, `scripts/mv-integration-pilot` smoke subset, `scripts/release-gates`, `scripts/security`, `scripts/superapp-certification`, `scripts/ultramodern-production-readiness`, `scripts/ultramodern-publish`, tsgo helper scripts, and `scripts/prepare-root.mjs`.
- Modified upstream script packages mostly carry tsgo/rstest/toolchain/package-json churn. Prefer upstream bug fixes, but keep fork executable paths and script package manager policy coherent.
- Deleted upstream script files: `scripts/build/bin/modern.js` and `scripts/build/src/cli_core_init.js`. This docs pass does not decide the docs-command binary cleanup; do not resurrect them while resolving unrelated docs or MF patch conflicts.

### Tests, docs, changesets, and patches — mixed

- `tests/**` has the largest non-package raw count because integration/e2e fixtures moved with fork defaults and generated-workspace proof coverage. Treat test changes as evidence for package/runtime behavior, not as standalone product features.
- `tests/integration/bff-corss-project` was renamed to `tests/integration/bff-cross-project`; the removed `bff-effect-lambda-only` fixture should not be resurrected because Effect-only BFF coverage now lives under `tests/integration/bff-effect`.
- `docs/super-app-rfc-adr/**`, `docs/research/**`, and `FORK-DIVERGENCE.md` are fork docs. Keep them truthful to live code after Phase A-C: Garfish runtime/trust lanes are historical, Module Federation is the live composition runtime, and generated-workspace proof scripts replace deleted repo-local proof lanes.
- `.changeset/**` entries are fork release metadata. Keep or regenerate per release train; do not treat them as upstreamable source changes.
- `patches/**` is external dependency patch policy. Keep it paired with `pnpm-workspace.yaml` and `pnpm-lock.yaml` patch hashes.

---

## packages/cli

### adapter-rstest (3 files) — [M]

Toolchain only: package.json scripts, rslib config, tsconfig `ignoreDeprecations`.

### builder (19 files)

- `src/createBuilder.ts`, `src/shared/parseCommonConfig.ts`, `src/types.ts` — [F] `performance.rsdoctor` opt-in config surface (`RsdoctorUserConfig`) and default HTML `templateParameters`. The fork-added `src/plugins/rsdoctor.ts` and `src/rsdoctorConfig.ts` carry the RsDoctor plugin split; RsDoctor defaults to OFF after the ADR-0001 revert (a210ac658d), and `tests/rsdoctor.test.ts` pins the behavior.
- `src/plugins/postcss.ts` — [U] resolves postcss/tailwind plugins from the app root via `createRequire` so monorepo/workspace installs resolve correctly.
- `src/plugins/rscConfig.ts`, `src/shared/rsc/rscClientBrowserFallback.ts`, `src/shared/devServer.ts` — [F] RSC layer matching extended to fork render-package dist entries (`render/dist/esm/rsc.mjs`) and server-loader entry patterns.
- `src/index.ts` — [M] export reshuffle.
- `tests/*` (8 files incl. snapshots) — [F] track the above behaviors.

### plugin-bff (14 files) — [F] Effect-first BFF lane

- `src/cli.ts`, `src/server.ts`, `src/loader.ts` — `bff.runtimeFramework: 'hono' | 'effect'` wiring + effect worker entry.
- `src/utils/{clientGenerator,runtimeGenerator,pluginGenerator,createHonoRoutes,crossProjectApiPlugin}.ts` — generator hardening per ADR-0005 (prefix conflicts are hard errors, deterministic package-metadata merge with collision detection) plus Effect client/data-platform generation. The fail-fast/merge hardening is upstreamable in isolation if ever wanted; the Effect parts are not.
- `src/runtime/*` (create-request, hono adapter/operators) — operation-context headers + envelope policy.
- package.json/tsconfig — [M].

### plugin-data-loader (7 files) — [M]

Import reordering/pragmas; storage import path swap; small strictness fixes.

### plugin-ssg (10 files) — [M]

Import reordering + minor destructuring/strictness cleanups in prerender/server paths.

### plugin-styled-components (2 files) — [F]

Styled-components v6-coupled type fix (`StyledInterface` no longer exported; derive from `typeof styledComponents.default`). Not in the current verified [U] queue because the dependency migration is fork-coupled.

## packages/document (118 files) — [F]

Full rebrand to UltraModern.js (en + zh): homepage, nav, get-started, BFF/Effect, TanStack, MF-SSR and deploy guides, rspress config, i18n strings, components. Permanent divergence; on sync, take upstream factual/API updates but re-apply branding and fork-feature pages by hand. Never bulk-accept upstream doc content.

## packages/runtime

### plugin-i18n (21 files) — [F]

Localised URLs (`shared/localisedUrls`), API-prefix locale-redirect skip incl. MF manifest endpoints (`/mf-manifest.json`, `/mf-stats.json`, `/remoteEntry.js` per ADR-0002), backend SDK/middleware split, I18nLink/hooks.

### plugin-image (5 files) — [M]

Type-cast strictness fix on ipx basename + toolchain configs.

### plugin-runtime (98 files) — the largest divergence

- `src/router/runtime/*` — [F] router runtime state machinery (`routerRuntime`/`routerServerSnapshot`/hydration script on the internal context) plus the fork-added router provider-registry (`provider.ts`) and state helpers (`lifecycle.ts`). The TanStack consolidation has landed: all TanStack code lives in `@modern-js/plugin-tanstack`, and `routerFramework` has been **removed** from the runtime context (no `src/` hits remain; `tests/core/react/wrapper.test.tsx:59,73` asserts its absence — see ADR-0017 §6).
- `src/router/runtime/PrefetchLink.tsx` — [U] candidate: intent/render/viewport prefetch behaviors + webpack chunk preload.
- `src/exports/head.ts` — [F] Helmet re-implemented over `react-helmet-async` with SSR `_helmetContext` plumbing.
- `src/core/server/*` (stream/string/requestHandler) — [F] router server snapshot + `loaderFailureMode` + helmet integration in SSR rendering. Fork SSR helper logic is now concentrated in fork-owned `src/core/server/{requestResponse.ts,routerCleanup.ts,scriptOrder.ts}`; `requestHandler.tsx` keeps the orchestration surface and `string/loadable.ts` imports script-order helpers instead of carrying them inline.
- `src/core/context/*`, `src/core/browser/*`, `src/core/compat/*` — [F] `TInternalRuntimeContext` extensions. `src/core/context/index.ts` now exports router runtime/provider types and lifecycle helpers used by `@modern-js/plugin-tanstack` through the public `@modern-js/runtime/context` seam.
- `src/router/cli/*` — [F] routes owner metadata (`BUILT_IN_ROUTES_OWNER`), config-routes converter, template generation.
- `src/document/*`, `src/exports/*`, `src/rsc/*`, `static/modern-inline.js` — [M]/[F] smaller adaptations.
- `tsconfig.json` — [M] `rootDir`/`baseUrl` only (the `src/ssr` exclude hunk was reverted when the orphaned legacy `src/ssr` copies were deleted in the 2026-06-12 cleanup).
- `tests/*` — track the above.

### render (7 files) — [F]

RSC adapter surface: `createFromFetch` export, `rscManifest` plumb-through, `react-server-dom-rspack.d.ts` updates.

## packages/server

### bff-core (12 files) — [F]

Operation contracts (schema hash, operation entries), cross-project policy evaluator (ADR-0005 §13), client generator emits operation-context bootstrap.

### bff-runtime (4 files) — [F] coupled dependency migration

package.json bumps farrow-api/farrow-pipeline/farrow-schema `^1.12` → `^2.3` (**majors**), and `src/index.ts:1` does `export * from 'farrow-schema'`, so the package's public API surface follows farrow 2.x. The `src/{index,match}.ts` diffs are otherwise import/export reordering, but `package.json` and source must be taken from the same side — **keep the fork version on sync**; do not resolve `package.json` toward upstream's farrow 1.x while keeping fork source (or vice versa).

### core (35 files)

- `src/adapters/node/plugins/static.ts` — [F] fork asset-serving behavior for pre-compressed assets (`.br`/`.gz` with Accept-Encoding q-value parsing); not in the current verified [U] queue.
- `src/types/config/server.ts` — [F] `server.telemetry` (exporters, SLO, canary, contract gates) + `ssr.moduleFederationAppSSR` + preload types.
- `src/types/config/bff.ts` — [F] `bff.crossProjectPolicy`.
- `src/plugins/{index,monitors,default}.ts`, `src/adapters/node/plugins/resource.ts` — [M] pure import/export re-sorting (the telemetry/contract-gate registration that used to live here was extracted to the fork-added `@modern-js/server-runtime-extensions` package, `packages/server/runtime-extensions/src/`; `grep -rn telemetry src/plugins/` in server-core returns zero hits).
- `src/plugins/render/{csrRscRender,ssrRender,renderRscHandler}.ts` — [F] fork RSC + router-snapshot integration.
- adapters/node helpers, `context.ts`, `utils/*`, `hono.ts` — [M]/[F] plumbing + strictness.

### create-request (10 files) — [F]

Producer-client hardening per ADR-0005: envelope policy, identity binding, transport resilience, canonical `traceparent` parsing/propagation (ce7c6b06ac).

### plugin-polyfill (4 files) — [F] coupled dependency migration

Breaking major-version runtime dep migrations, not mechanical churn: ua-parser-js `0.7` → `2.0` with a call-site rewrite in `src/index.ts:34-36` (`new UAParser.UAParser(ua).getResult()` against the v2 module shape), and lru-cache `6` → `11` with the constructor API rewrite in `src/libs/cache.ts:39-40` (`max`/`length` → `maxSize`/`sizeCalculation`). **Keep the fork version on sync** for both `package.json` and source as a pair — taking upstream source against the fork's 2.x/11.x deps (or the reverse) produces a runtime-broken package.

### prod-server (5 files) — [F]

Telemetry re-export surface (re-exported from `@modern-js/server-runtime-extensions` — see `src/apply.ts:23`, `src/index.ts:17`), typed `createProdServer`, netlify entry. (MF cache headers now live in `@modern-js/server-runtime-extensions`.)

### server (16 files) — [M]

Mostly mechanical; plus typed `CreateDevServerResult` and undefined-guards in watcher/fileReader ([U]-grade strictness fixes, same family as render.ts). One semantic delta hides in the churn: `src/helpers/mock.ts:117-120` dropped `encode: encodeURI` from the path-to-regexp `match` options (plus `method ?? 'get'` / `pathname ?? '/'` fallbacks in `parseKey`), which changes dev-mock route matching for non-ASCII paths. Dev-tooling only, but on conflict in this file keep the fork side or consciously re-add `encode` — do not assume the whole package is take-upstream-safe.

### server-runtime (3 files) — [M]

Export reordering only.

### utils (9 files) — [F]

TypeScript compiler path rebuilt around tsgo (spawned `tsgo`, tsconfig-paths matcher, import-specifier rewriting). Toolchain divergence.

## packages/solutions/app-tools (61 files) — [F]

- config/initialize, `src/index.ts`, types — wiring for fork-added `baseline.ts` (`presetUltramodern` defaults: telemetry, MF SSR).
- `src/builder/generator/getBuilderEnvironments.ts` — Effect BFF worker entry + Cloudflare worker compat template resolution.
- `src/plugins/deploy/*` — platform entries. (The `deploy.microFrontend.{runtimeDigest,integrity,attestation}` trust-contract fields were removed in the 2026-06-12 cleanup; `MicroFrontend` is back to upstream shape.)
- `src/commands/*` — dev/build/serve hooks + `modern runtime status|fallback-signal` registration (EPIC-7).
- `src/plugins/analyze/*` — entry/routes-owner integration.
- esm register hooks, utils, tests — [M]/track the above.

## packages/toolkit

### create (6 files) — [F]

`create` defaults to the ultramodern workspace generator; `--legacy-modern-js`
escape hatch; `@bleedingdev` package-source resolution; public generator API
subpaths (`./ultramodern-workspace`, `./ultramodern-workspace/codesmith`);
MicroVertical dry-run/preflight validation; explicit CodeSmith overlay hook.
UltraModern tooling commands are split under
`src/ultramodern-tooling/commands/` instead of one monolithic command file.
Workspace content that used to be emitted from TypeScript strings is moving to
`templates/workspace/` shipped file templates. Shared workspace patches are
gated by `tests/patch-sync.test.ts`; `patches/README.md` documents the
repo-only / shared / template-only three-way split.
Sync policy: do not restore private-path generator consumers or upstream
single-app template entrypoints. Port upstream template fixes into the
UltraModern workspace templates by hand, keep overlays post-generation only, and
keep `exports` plus `publishConfig.exports` mirrored with the runtime files.

### plugin (26 files) — [M]

Mostly import/type re-export hygiene; plus fork duplicate-plugin detection across internal + config plugins.

### runtime-utils (11 files) — [F]

`nestedRoutes` browser export, `url` normalizePathname, loaderContext, async storage, fileReader — support the fork router/runtime lanes. rstest config moved to happy-dom [M].

### sandpack-react (2 files) — [M]

Build script (node strip-types + `tsgo:dts`) and dependency alignment. File inventory changed in the 2026-06-12 cleanup: the generated `src/templates/{mwa,common}.ts` are untracked gitignored build outputs again (matching upstream), and the upstream single-app MWA template content is vendored at `scripts/mwa-template/` (see Appendix A).

### types (6 files) — [F]

Server/CLI type surface additions: tanstack route fields (`loaderDeps`, `validateSearch`), `unsafeHeaders`, `cacheConfig`. (`common/index.d.ts` matches the upstream baseline again — the fork-added babel/moduleSdk re-exports were removed and `common/moduleSdk.d.ts` deleted in the 2026-06-12 cleanup.)

### utils (20 files) — mixed

- `compiled/pkg-up/*` — [F] vendored compiled blob replaced with a readable reimplementation (same API).
- `src/cli/constants.ts` — [F] fork constants (`NESTED_ROUTE_SPEC_FILE`, etc.).
- `src/universal/backend-federation-contract.ts` — [F] shared UltraModern delivery-unit/backend-federation contract consumed by create, app-tools, and plugin-bff.
- rest (logger, version, require, is/get) — [M] reordering + strictness.

## packages/tsconfig (1 file) — [M]

`base.json` adds `ignoreDeprecations: "6.0"` for the TS 6 toolchain.

---

## Appendix A — deleted or template-moved upstream files (19): keep deleted on sync

Raw `-M` reports 5 deleted files plus 14 exact `R100` template moves. Treat all
19 original upstream paths as keep-deleted during sync. On merge they conflict
as delete/modify, rename/modify, or silently resurrect — re-delete the original
path and port any upstream change into the listed fork replacement instead.

- `packages/runtime/render/modern.config.js` — build config replaced by fork-added `rslib.config.mts`. Keep deleted; port upstream build-config changes into the rslib config.
- `packages/server/utils/src/compilers/typescript/typescriptLoader.ts` — the TS compile path was rebuilt around tsgo (see the `server/utils` entry above). Keep deleted; re-express upstream loader fixes in the fork's tsgo compiler path under `src/compilers/typescript/`.
- `packages/solutions/app-tools/src/esm/ts-node-loader.mjs` + `packages/solutions/app-tools/tests/utils/ts-node-loader.test.ts` — ts-node ESM loader dropped for the tsgo toolchain; the fork keeps `src/esm/register-esm.mjs` and `src/esm/ts-paths-loader.mjs`. Keep deleted; map upstream loader changes onto `ts-paths-loader.mjs`.
- `packages/toolkit/create/template/**` (14 files: `.browserslistrc`, `.gitignore.handlebars`, `.npmrc`, `.nvmrc`, `README.md`, `biome.json`, `modern.config.ts`, `package.json.handlebars`, `tsconfig.json`, `src/modern-app-env.d.ts`, `src/modern.runtime.ts`, `src/routes/{index.css,layout.tsx,page.tsx}`) — the handlebars single-app template was replaced by the fork-added ultramodern workspace generator (`src/ultramodern-workspace/`, `template-workspace/`, `templates/`). Keep deleted; mirror upstream template-content changes in the workspace templates only where they still apply. The upstream single-app template content is additionally vendored byte-identically at `packages/toolkit/sandpack-react/scripts/mwa-template/` (with `biome.json` stored as `biome.json.handlebars`) as the source of the Sandpack `web-app` template — mirror upstream `create/template` content changes there too.
- `packages/toolkit/sandpack-react/scripts/template.ts` — replaced by fork-added `scripts/template.mts` run via `node --experimental-strip-types` (see `package.json:37`). Keep deleted; apply upstream script changes to the `.mts` version. `template.mts` now renders `scripts/mwa-template/` (upstream MWA content) instead of `template-workspace`, and the generated `src/templates/{mwa,common}.ts` are untracked gitignored build outputs again, matching upstream.

## Appendix B — renamed + modified upstream files (3): follow the rename

Git resolves these only with rename detection on (`-M`); without it they look like delete + add. Apply upstream edits to the **new** path, then re-apply fork content.

- `packages/document/docs/en/apis/app/runtime/bff/use-hono-context.mdx` → `use-backend-context.mdx` (R087) and the `zh` twin (R088) — renamed for runtime-framework-neutral BFF naming, ~12-13% content change. Follow the rename; treat content per the `packages/document` [F] rule above.
- `packages/runtime/plugin-runtime/scripts/gen-static.ts` → `scripts/gen-static.mts` (R075, ~25% modified) — ESM script for the tsgo toolchain. Follow the rename; port upstream script logic into the `.mts` file.

---

## Appendix C — 2026-06-12 brutal-cleanup removals (fork-added code; keep deleted on sync)

The fork-audit cleanup (see `docs/research/fork-audit-2026-06-12-findings.md`) deleted the following **fork-added** code. None of it exists upstream at the baseline, so a sync never resurrects it — this list exists so the deletions are not mistaken for merge losses.

Packages:

- `packages/runtime/plugin-garfish` — the fork-rewritten Garfish compat lane (trust/compatibility/fallback-telemetry/cache-policy). Module Federation is the sole micro-frontend runtime surface (ADR-0011 retired). Upstream removed its own plugin-garfish before the baseline; keep deleted.
- `packages/server/plugin-koa`, `packages/server/plugin-express` — fork-resurrected v2 BFF adapter packages (re-added in 42e2dcf66f, absent upstream since v3, both `private: true` and unpublished). Deleted per findings server-lane#3 / xcut-dead-features#3: the v3 BFF pipeline is hono/effect-only (`BffRuntimeFramework` in `packages/server/core/src/types/config/bff.ts`) and the adapters' node-style handlers could not satisfy the hono `prepareApiServer` contract. Hono-side cross-project enforcement lives in plugin-bff's `crossProjectApiPlugin`; coverage lives in bff-core's `crossProjectPolicy`/`resolveCrossProjectPolicy`/`adapterKit` tests.
- `packages/builder/**` (5 stale orphan files) — upstream removed `packages/builder` in 4df6c876aa; the fork copies (incl. the DIAG-0001 `performance.ts` diagnostics writer that never had a live producer) are deleted.
- `packages/runtime/plugin-runtime/src/ssr/**` (4 orphaned legacy SSR copies), `packages/toolkit/runtime-utils/src/universal/async_storage.server.worker.ts`, `packages/toolkit/types/common/moduleSdk.d.ts` — fork-added orphans, deleted.
- prod-server zombie lane: `src/server/{index,modernServerSplit}.ts`, `src/libs/{runtimeFallbackWorkerLane,loadConfig,metrics}.ts`, `src/utils.ts` and the worker-lane config surface; `benchmark/runtime-resilience`. The live telemetry lane is `@modern-js/server-runtime-extensions`.

Scripts and CI (fork-added; ~repo-tooling only):

- MV governance layer (~6,550 LOC) per scripts-mv#1..#10: `scripts/mv-zephyr-profile`, `scripts/mv-production-rollout`, `scripts/mv-ci-hardening`, `scripts/mv-lane-policy`, `scripts/wave0-mv-contracts`, 3 of 5 `scripts/mv-integration-pilot` drills, and both `.github/workflows/mv-*.yml`. Kept: the `validate:mv-topology-smoke` lane (reference-topology + design-system-bad-release-drill).
- SuperApp load/preflight chain: `scripts/superapp-k6` (5.2k-line lane that could never execute — k6/autocannon installed nowhere, every invocation skip-passed against a server that was never started; scripts-superapp#1), `scripts/superapp-load` (third load engine, single consumer; xcut-scripts-duplication#8), `scripts/ultramodern-preflight` + `scripts/ultramodern-contract-doctor` + `scripts/superapp-local-control-plane` (chain broken on every fresh workspace, wired to no CI; scripts-ultramodern#1-2), `scripts/superapp-certification/validate-harness-contract.js` (vacuous gate; scripts-superapp#4). Certification profiles slimmed (release 16→12, nightly 22→15 commands); the readiness report no longer converts skipped/budget-failed artifacts into passed evidence (scripts-superapp#2). Surviving validation: `tests/integration/create-ultramodern-workspace` plus each generated workspace's own `scripts/validate-ultramodern-workspace.mjs`.
- Dead script families per scripts-misc: `scripts/ultramodern-version-switching` (tautological self-simulation), `scripts/ultramodern-cloudflare-ssr-validation` (duplicated the workspace cloudflare proof; retired Tractor defaults), `scripts/ultramodern-zephyr-live-evidence` (hardcoded retired Tractor topology), `scripts/ai-capabilities` (LSP-framed MCP bridge no MCP client can speak + tautological parity gate), `scripts/test-orchestrator` (no consumer), `scripts/ultramodern-publish/resolve-affected-packages.mjs` (contradicted the enforced full-cohort publish). The ownership/blast-radius module was removed from `scripts/boundary-guards/validator.js`. `scripts/ultramodern-zephyr-ssr-upload` and `scripts/ultramodern-publish-readiness` were deleted in cleanup round 23 (no live automated consumer; publish-readiness duplicated source-create-proof validation).

## Sync guidance

1. Resolve [M] conflicts toward upstream, then re-run `npx biome check --write` and restore `@effect-diagnostics` pragmas.
2. Keep the fork side for everything [F]; diffs inside upstream-owned files are intentionally minimal — if a conflict looks large, check whether the logic should move to a fork-owned module instead. For the coupled dependency migrations (`bff-runtime`, `plugin-polyfill`) keep `package.json` + source together — never split sides within the package.
3. Current verified [U] queue: builder `postcss.ts` app-root resolution and runtime `PrefetchLink.tsx` intent/render/viewport prefetch. Service-worker ESM output, the edge-safe language detector, and `matchRoute` undefined narrowing landed upstream and are no longer fork divergences.
4. Deleted upstream files (Appendix A): keep them deleted; a merge that resurrects one is wrong even if it applies cleanly. Port the upstream change into the fork replacement listed per file.
5. Renamed files (Appendix B): run the sync with rename detection on (`git merge`/`git diff -M`) and land upstream edits on the renamed path.
