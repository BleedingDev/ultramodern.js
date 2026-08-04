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
- **Effect cohort pin — [F] (2026-08-03).** Upstream has no Effect lane and pins
  nothing. The fork pins one lockstep cohort (currently `4.0.0-beta.102`) across
  five sites that must move in a single commit:
  `pnpm-workspace.yaml` `minimumReleaseAgeExclude` (`effect@…`,
  `@effect/opentelemetry@…`), `EFFECT_VERSION`/`EFFECT_VITEST_VERSION` in
  `packages/toolkit/create/src/ultramodern-workspace/versions.ts`,
  `packages/cli/plugin-bff/package.json` (dep/peer/devDep — see the plugin-bff
  entry), the generated-workspace `pnpm.overrides`/`trustPolicyExclude` emitted
  by `ultramodern-workspace/policy.ts`, and
  `packages/toolkit/create/template-workspace/patches/effect-schema-error-type-id.patch`.
  That patch restores the erased `preResponseHandler.d.ts` type exports; its
  `index <blob>..<blob>` header is version-specific, so a version bump without
  `pnpm patch effect@<new-version>` produces a patch that silently fails to
  apply. The patch is **template-only** (it is deliberately absent from the
  repo-root `patches/` and from `SHARED_ULTRAMODERN_WORKSPACE_PATCH_FILES`, so
  `tests/patch-sync.test.ts` guards its absence there, not its content); its
  content is pinned instead by the `sha256` recorded in the two
  `stalePatchPolicies` entries at
  `packages/toolkit/create/src/ultramodern-workspace/policy.ts:449-486`.
  Guards: `packages/toolkit/create/tests/version-pins.test.ts` and
  `packages/toolkit/create/tests/migrate-release-age-policy.test.ts`. A merge
  that reverts any one site to upstream leaves the other four pointing at a
  version that is no longer installed.

- **Examples consume the workspace, not the registry — [F] (2026-08-04).** Every
  `@modern-js/*` dependency in the 15 `examples/**` workspace members is
  `workspace:*`; upstream declares them `latest`. Under upstream's spelling a
  `pnpm install` in this fork downloads real Modern.js (`3.7.0`) beside the fork's
  own packages, and pnpm hoists one of the two into
  `node_modules/.pnpm/node_modules/@modern-js/*`. Which one wins is not
  deterministic across machines, so any code that resolves a bare
  `@modern-js/*` specifier from outside the workspace tree — the plugin-bff
  generator fixtures do exactly this — silently binds to upstream on CI and to
  the fork locally, and fork-only subpaths (`./effect-client`, `./effect`) fail
  with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Take upstream's example *sources* on
  sync; keep `workspace:*` on their manifests.

### CI and GitHub workflows — mixed

- Added fork-owned workflows: `boundary-anti-patterns.yml`, `bun-superapp-smoke.yml`, `contract-gates.yml`, `docs-pages.yml`, `publish-bleedingdev.yml`, `superapp-certification.yml`, `ultramodern-nightly.yml`, `ultramodern-production-readiness.yml`, `workflow-security.yml`.
- Modified upstream workflows: dependency check, diff, integration tests, lint, type-check, unit tests, builder e2e, and issue labels. Reconcile upstream infrastructure fixes by hand; keep fork gates only where their scripts still exist.
- Deleted Phase A-C workflow names are intentionally not live: the old `.github/workflows/mv-*.yml` governance layer was removed with the dead script families in Appendix C. Do not cite those workflows as current evidence.
- **Release tag namespace — [F] (2026-08-04).** This repository carries 271 inherited upstream Modern.js `v*` tags (`v1.x` … `v3.4.0`). `gh release create` REUSES a pre-existing tag and silently ignores `--target`, so the fork's `publish-change-record` job tags releases as `ultramodern-v<version>`, never `v<version>`, and refuses to proceed if that tag already exists at a different commit. The step is idempotent (`gh release view` → `edit`, else `create`) because it runs AFTER the unrollbackable npm publish. `RELEASE_TAG_PREFIX` in `scripts/ultramodern-publish/gen-cohort-change-record.mjs` must stay in sync with the workflow: it is also the since-boundary the change record uses.
- **`publish-change-record` is the only `contents: write` job.** `scripts/ultramodern-publish/validate-publish-security.mjs` now asserts a closed set over `Object.keys(jobs)`, that exactly one job carries `contents: write`, that its permissions are exactly `{contents: write}`, and that its `if:` restricts to the owner/branch/non-dry-run. Adding a job to the publish workflow is a deliberate edit to that closed set.

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
- `pnpm-workspace.yaml` `packages:` — [F] (2026-08-04) carries the negative globs `'!tests/integration/**/dist/**'` and `'!tests/integration/**/node_modules/**'`. Gitignored build output under `tests/integration/**` contains emitted `package.json` files (e.g. `routes-tanstack-mf/mf-remote/dist/shared/effect`) that match the positive globs, so any local `pnpm install` on a dirty tree added phantom importers to `pnpm-lock.yaml` and silently changed what `--frozen-lockfile` considers in sync. Upstream has no such emitted manifests. Verified: removing the negation makes `pnpm ls -r --depth -1` report the `dist/shared/effect` project (1 → 0 with it).
- `scripts/check-changeset/src/index.ts` — [F] (2026-08-04) `FORK_ALLOWED_MAJOR_CHANGESET_IDS`. Upstream only permits a `major` bump inside a changeset whose id contains `modern-3` (the Modern.js 3.0 release train). The fork ships breaking changes outside that train, so each one is allowlisted by id instead of weakening the gate. Adding an entry is the conscious act of accepting a breaking change.
- `examples/basic-withZephyr/package.json` — [U] (2026-08-03). This example post-dates the `8a744c1b` merge-base (upstream added it in `7b1292d5c5`, "migrate examples from modern-js-examples into the monorepo"), so it does not appear in the raw counts above. Upstream still pins `zephyr-modernjs-plugin@1.1.0` + `zephyr-rspack-plugin@1.1.0`; `zephyr-modernjs-plugin@1.1.0` declares `peerDependencies['@modern-js/app-tools']: ^2.0.0`, which the installed `@modern-js/app-tools@3.7.0` does not satisfy — a real unmet peer masked by the root `strictPeerDependencies: false`. The fork bumps both to `1.2.1`, whose peer range is `^3.0.0`. Pure hygiene, upstreamable as-is; on sync, prefer the fork side unless upstream has bumped further. Verified by `pnpm install --strict-peer-dependencies` (exit 0, zero `zephyr` peer diagnostics; before the bump the lockfile records the `^2.0.0` peer). The example itself is **not** a fork regression testbed: it is in no CI job and its `latest` specifiers resolve to the upstream registry, not the fork (`linkWorkspacePackages: false`).
- Do **not** add `peerDependencyRules.allowedVersions` entries for `@modern-js/app-tools`. Empirically (2026-08-03) pnpm 11 compares peer ranges on major.minor.patch and ignores the prerelease tag, so an aliased `@bleedingdev/modern-js-*@3.5.0-ultramodern.NN` already satisfies `^3.0.0` under `--strict-peer-dependencies`. If a rule is ever genuinely needed for some other plugin, the key must be the **alias/peer** name (never the real `@bleedingdev/…` name) and the value must be an exact version — `'*'` does not match a prerelease and silently does nothing.

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

- `src/cli.ts`, `src/server.ts`, `src/loader.ts` — `bff.runtimeFramework: 'hono' | 'effect'` wiring + effect worker entry. `src/server.ts` — [F] (2026-08-04) loads `EffectAdapter` through a **dynamic** `await import('./runtime/effect/adapter')` inside `onPrepare`, never a static top-level import. A static import pulls `effect/Effect`, `effect/Layer`, `effect/Schema` and `effect/unstable/http*` into the eager module graph of `@modern-js/plugin-bff/server-plugin`, so a hono-only consumer that has not installed the optional `effect` peer crashes on import with `ERR_MODULE_NOT_FOUND`. Guard: `tests/regression.test.ts` (`server entry does not eagerly load Effect`).
- `src/utils/{clientGenerator,runtimeGenerator,pluginGenerator,createHonoRoutes,crossProjectApiPlugin}.ts` — generator hardening per ADR-0005 (prefix conflicts are hard errors, deterministic package-metadata merge with collision detection) plus Effect client/data-platform generation. The fail-fast/merge hardening is upstreamable in isolation if ever wanted; the Effect parts are not.
- `src/runtime/*` (create-request, hono adapter/operators) — operation-context headers + envelope policy.
- `package.json` — [F] (2026-08-04) **entirely fork-added dependency block.** Upstream's plugin-bff has no `effect` dependency and no `peerDependencies` block at all. The fork declares `peerDependencies: { effect: '<cohort>', '@effect/opentelemetry': '<cohort>' }`, both marked `optional` in `peerDependenciesMeta`, and mirrored exact `devDependencies` for both (needed because `autoInstallPeers: false`). `@effect/opentelemetry` MUST move with `effect`: it declares a REQUIRED (non-optional) `effect` peer of its own, so leaving it in `dependencies` re-imposes that peer on every hono-only consumer transitively and makes the optional `effect` peer a fiction. Why: Effect must resolve to **one** identity in the consumer's graph — shipping it as a hard `dependencies` entry lets pnpm install a second copy alongside the app's own, and `export * from 'effect/unstable/http'` in the runtime barrels then hands back services from the wrong Effect instance. Because the block is purely additive, a sync merge will not conflict on it, so a resolver taking "theirs" wholesale drops it **silently**. Guards: `packages/cli/plugin-bff/tests/regression.test.ts` (asserts, for BOTH `effect` and `@effect/opentelemetry`, that `dependencies[name] === undefined`, `peerDependencies[name] === devDependencies[name]`, `peerDependenciesMeta[name].optional === true`; plus `server entry does not eagerly load Effect`) and `packages/toolkit/create/tests/version-pins.test.ts` (`plugin-bff declares the same Effect cohort generated workspaces pin`). Moving the cohort means moving four sites in lockstep — the otel dep, the peer, the devDep, and `pnpm-workspace.yaml` `minimumReleaseAgeExclude` — plus `EFFECT_VERSION` in `packages/toolkit/create/src/ultramodern-workspace/versions.ts`.
- tsconfig — [M].

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

`src/runtime/i18n/instance.ts` — [F] (2026-08-03) the `I18nInstance` interface deliberately has **no** top-level index signature and uses **single, non-overloaded** method signatures. Upstream declares `[key: string]: any` plus overloaded call-signature properties; TypeScript never grants an interface an implicit index signature, so upstream's shape makes i18next's `i18n` permanently unassignable and the documented `i18nInstance: i18next` usage (written by all eight `tests/integration/i18n/*/src/modern.runtime.tsx` fixtures) does not typecheck. Overload bivariance was also proven order-dependent across program compositions on both tsgo and tsc. On sync, do **not** take upstream's interface body wholesale — that silently re-breaks assignability. The guard is `packages/runtime/plugin-i18n/tests/type-fixture/i18nInstanceTypes.fixture.ts`, executed by `tests/linkTypes.test.ts`. `t` is a REQUIRED member (upstream declares no `t` at all), so every object literal producing an `I18nInstance` must supply one — including the three factories in `tests/{link,routerAdapter,i18nUtils}.test.*`. Coupled fork edits: `src/runtime/contextHelpers.ts` (cast for the fixed-arity `t`, invoked via `translate.call(i18nInstance, …)` so a custom `t` that reads `this` still works — i18next's own `t` is bound and would hide the bug), `src/runtime/hooks.ts` (throwing `t` stub on `createMinimalI18nInstance`), `src/runtime/context.tsx` (`useModernI18n<TInstance extends I18nInstance>` generic), `src/runtime/core.tsx` (re-exports `I18nInstance`/`TranslateFn`/`UseModernI18nReturn`). `tsconfig.json` — [F] (2026-08-04) `baseUrl` removed: TypeScript 7 / tsgo reject it outright (TS5102), so the package's own tsconfig could not be typechecked at all; `paths` was empty, so nothing resolved through it. Do not restore it on sync.

### plugin-image (5 files) — [M]

Type-cast strictness fix on ipx basename + toolchain configs.

### plugin-runtime (98 files) — the largest divergence

- `src/router/runtime/*` — [F] router runtime state machinery (`routerRuntime`/`routerServerSnapshot`/hydration script on the internal context) plus the fork-added router provider-registry (`provider.ts`) and state helpers (`lifecycle.ts`). The TanStack consolidation has landed: all TanStack code lives in `@modern-js/plugin-tanstack`, and `routerFramework` has been **removed** from the runtime context (no `src/` hits remain; `tests/core/react/wrapper.test.tsx:59,73` asserts its absence — see ADR-0017 §6).
- `src/router/runtime/PrefetchLink.tsx` — [U] candidate: intent/render/viewport prefetch behaviors + webpack chunk preload.
- `src/exports/head.ts` — [F] Helmet re-implemented over `react-helmet-async` with SSR `_helmetContext` plumbing.
- `src/core/server/*` (stream/string/requestHandler) — [F] router server snapshot + `loaderFailureMode` + helmet integration in SSR rendering. Fork SSR helper logic is now concentrated in fork-owned `src/core/server/{requestResponse.ts,routerCleanup.ts,scriptOrder.ts}`; `requestHandler.tsx` keeps the orchestration surface and `string/loadable.ts` imports script-order helpers instead of carrying them inline.
- `src/core/server/string/index.ts` — [F] (2026-08-03) `createReplaceSSRDataScript` routes `SSR_DATA_PLACEHOLDER` through the fork-owned `replaceChunkJsPlaceholder`/`injectBeforeHydrationEntryScript` (`src/core/server/scriptOrder.ts`) instead of upstream's plain `safeReplace`, so `window._SSR_DATA` and the router hydration block (including the TanStack `$_TSR` bootstrap) are emitted **before** the entry script in string mode — the same guarantee stream mode already gets at `stream/afterTemplate.ts`. Measured on `tests/integration/routes-tanstack` before the fix: `/stream` bootstrap@11932 < entry@12523 (safe) but `/string` entry@11958 < bootstrap@12977 (raced); deferring the bootstrap reproduces React `#418` with the SSR DOM node discarded. It degrades to `safeReplace` when no entry script tag is found (custom HTML templates, MF host shells). Upstream still owns the plain `safeReplace` here, so a sync merge that takes "theirs" silently reopens the ordering gap. Guards: `packages/runtime/plugin-runtime/tests/ssr/serverRender/renderToString/buildTemplate.test.tsx` (unit) and the byte-offset assertion in `tests/integration/routes-tanstack/tests/index.test.ts`.
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

`src/security/operationContracts.ts` — [F] (2026-08-04) the optional `zod` peer is loaded through a **runtime-assembled specifier** (`['z','o','d'].join('')`) passed to `createRequire(...)`, never a literal `require('zod')` or a static import. rslib/rspack externalizes a literal require into a TOP-LEVEL `import * as … from "zod"` in the `esm-node` output, which turned an optional peer into a hard runtime requirement: `@modern-js/plugin-bff`'s root, `./cli`, `./server-plugin` and `./hono-server` entries all reach this module transitively and threw `ERR_MODULE_NOT_FOUND: zod` for any consumer that had not installed zod. Do not "simplify" this back to a literal on sync. Guard: `packages/server/bff-core/tests/optionalZodPeer.test.ts` (asserts the source shape and that no built format carries an eager zod dependency).

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
Post-baseline addition (not in the 19 above, because the file does not exist at
`8a744c1b`):

- `examples/basic-withZephyr/.npmrc` — (2026-08-03) upstream ships this file containing only `strict-peer-dependencies=false`. pnpm 11 does not read `strict-peer-dependencies` from `.npmrc` at all (only `pnpm-workspace.yaml` `strictPeerDependencies` / the CLI flag take effect — same reason the root `.npmrc` settings were migrated), so it is dead config that misleads anyone debugging peer resolution in this example. Keep deleted on sync.

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
