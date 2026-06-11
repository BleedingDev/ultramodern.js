# FORK-DIVERGENCE — modified upstream files ledger

Read this during every upstream sync. Merge-base: `8a744c1b` (v3.2.1), upstream = `origin` (web-infra-dev/modern.js).

Scope: upstream files **modified** by the fork. Regenerate the raw list with:

```sh
git diff origin/main...HEAD --name-status -- packages | grep '^M'
```

Fork-**added** files and packages (`@modern-js/plugin-tanstack`, the rewritten `plugin-garfish` contents, server-core telemetry/contract-gate modules, `app-tools/src/baseline.ts`, prod-server worker lane, etc.) are fork-owned by definition and not listed here.

Legend:

- **[U]** upstreamable — a candidate to PR to web-infra-dev/modern.js in isolation.
- **[F]** permanent fork divergence — only meaningful with the ultramodern lanes (Effect BFF, TanStack, SuperApp trust, telemetry, tsgo toolchain).
- **[M]** mechanical — biome import re-sorting, `@effect-diagnostics` pragma headers (~73 of the 538 modified files), tsconfig `rootDir`/`ignoreDeprecations`, package.json script/dep churn for the tsgo + rstest toolchain. Safe to take either side on conflict; prefer upstream content and re-run biome/pragma tooling.

Headline: **`packages/server/core/src/plugins/render/render.ts` — `matchRoute` undefined-narrowing is an upstreamable bug fix.** Upstream returns `[]` cast to `MatchedRoute` when nothing matches, so callers destructure `undefined` as a `ServerRoute`. The fork types the miss explicitly (`[ServerRoute | undefined, Params]`, returns `[undefined, {}]`). PR this upstream; until then, always keep the fork side in merges.

Total at last audit (2026-06-11): 538 modified files.

---

## packages/cli

### adapter-rstest (3 files) — [M]

Toolchain only: package.json scripts, rslib config, tsconfig `ignoreDeprecations`.

### builder (19 files)

- `src/createBuilder.ts`, `src/shared/parseCommonConfig.ts`, `src/types.ts` — [F] `performance.rsdoctor` opt-in config surface (`RsdoctorUserConfig`) and default HTML `templateParameters`. NOTE: after the ADR-0001 revert (a210ac658d) RsDoctor defaults to OFF; the JSDoc on `RsdoctorUserConfig.enabled` still claims production default-on and is stale (see `tests/rsdoctor.test.ts` for actual behavior).
- `src/plugins/environmentDefaults.ts` — [U] service-worker environment emits ESM library output when `output.module` is set (upstream hardcodes `commonjs2`).
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

### plugin-styled-components (2 files) — [U]

Type fix for styled-components v6 (`StyledInterface` no longer exported; derive from `typeof styledComponents.default`).

## packages/document (118 files) — [F]

Full rebrand to UltraModern.js (en + zh): homepage, nav, get-started, BFF/Effect, TanStack, MF-SSR and deploy guides, rspress config, i18n strings, components. Permanent divergence; on sync, take upstream factual/API updates but re-apply branding and fork-feature pages by hand. Never bulk-accept upstream doc content.

## packages/runtime

### plugin-i18n (20 files) — [F]

Localised URLs (`shared/localisedUrls`), API-prefix locale-redirect skip incl. MF manifest endpoints (`/mf-manifest.json`, `/mf-stats.json`, `/remoteEntry.js` per ADR-0002), backend SDK/middleware split, I18nLink/hooks.

### plugin-image (5 files) — [M]

Type-cast strictness fix on ipx basename + toolchain configs.

### plugin-runtime (98 files) — the largest divergence

- `src/router/runtime/*` — [F] router runtime state machinery (`lifecycle.ts`, `routerRuntime`/`routerServerSnapshot`/hydration script on the internal context), `routerFramework` on the context (slated for removal — see ADR-0017), plus the in-tree tanstack subtree being consolidated into `@modern-js/plugin-tanstack`.
- `src/router/runtime/PrefetchLink.tsx` — [U] candidate: intent/render/viewport prefetch behaviors + webpack chunk preload.
- `src/exports/head.ts` — [F] Helmet re-implemented over `react-helmet-async` with SSR `_helmetContext` plumbing.
- `src/core/server/*` (stream/string/requestHandler) — [F] router server snapshot + `loaderFailureMode` + helmet integration in SSR rendering.
- `src/core/context/*`, `src/core/browser/*`, `src/core/compat/*` — [F] `TInternalRuntimeContext` extensions.
- `src/router/cli/*` — [F] routes owner metadata (`BUILT_IN_ROUTES_OWNER`), config-routes converter, template generation.
- `src/document/*`, `src/exports/*`, `src/rsc/*`, `static/modern-inline.js` — [M]/[F] smaller adaptations.
- `tests/*` — track the above.

### render (7 files) — [F]

RSC adapter surface: `createFromFetch` export, `rscManifest` plumb-through, `react-server-dom-rspack.d.ts` updates.

## packages/server

### bff-core (12 files) — [F]

Operation contracts (schema hash, operation entries), cross-project policy evaluator (ADR-0005 §13), client generator emits operation-context bootstrap.

### bff-runtime (4 files) — [M]

Export reordering only.

### core (35 files)

- `src/plugins/render/render.ts` — **[U] `matchRoute` undefined-narrowing bug fix — see headline above.**
- `src/adapters/node/plugins/static.ts` — [U] candidate: pre-compressed asset serving (`.br`/`.gz` with Accept-Encoding q-value parsing).
- `src/types/config/server.ts` — [F] `server.telemetry` (exporters, SLO, canary, contract gates) + `ssr.moduleFederationAppSSR` + preload types.
- `src/types/config/bff.ts` — [F] `bff.crossProjectPolicy`.
- `src/plugins/{index,monitors,default}.ts` — [F] telemetry/contract-gate registration and re-exports.
- `src/plugins/render/{csrRscRender,ssrRender,renderRscHandler}.ts` — [F] fork RSC + router-snapshot integration.
- adapters/node helpers, `context.ts`, `utils/*`, `hono.ts` — [M]/[F] plumbing + strictness.

### create-request (10 files) — [F]

Producer-client hardening per ADR-0005: envelope policy, identity binding, transport resilience, canonical `traceparent` parsing/propagation (ce7c6b06ac).

### plugin-polyfill (4 files) — [M]

Import reordering + minor cache lib touch.

### prod-server (5 files) — [F]

Telemetry re-export surface, typed `createProdServer`, netlify entry. (MF cache headers + worker lane live in fork-added files under `src/libs/` and `src/server/`.)

### server (16 files) — [M]

Mostly mechanical; plus typed `CreateDevServerResult` and undefined-guards in watcher/fileReader ([U]-grade strictness fixes, same family as render.ts).

### server-runtime (3 files) — [M]

Export reordering only.

### utils (9 files) — [F]

TypeScript compiler path rebuilt around tsgo (spawned `tsgo`, tsconfig-paths matcher, import-specifier rewriting). Toolchain divergence.

## packages/solutions/app-tools (60 files) — [F]

- config/initialize, `src/index.ts`, types — wiring for fork-added `baseline.ts` (`presetUltramodern` defaults: telemetry, MF SSR).
- `src/builder/generator/getBuilderEnvironments.ts` — Effect BFF worker entry + Cloudflare worker compat template resolution.
- `src/plugins/deploy/*` — platform entries + `deploy.microFrontend.{runtimeDigest,integrity,attestation}` trust contract (ADR-0002 §10-11).
- `src/commands/*` — dev/build/serve hooks + `modern runtime status|fallback-signal` registration (EPIC-7).
- `src/plugins/analyze/*` — entry/routes-owner integration.
- esm register hooks, utils, tests — [M]/track the above.

## packages/toolkit

### create (6 files) — [F]

`create` defaults to the ultramodern workspace generator; `--legacy-modern-js` escape hatch; `@bleedingdev` package-source resolution.

### i18n-utils (3 files) — [U]

`languageDetector` guards `globalThis.process` access (edge/worker-safe).

### plugin (26 files) — [M]

Mostly import/type re-export hygiene; plus duplicate-plugin detection across internal + config plugins ([U] candidate).

### runtime-utils (11 files) — [F]

`nestedRoutes` browser export, `url` normalizePathname, loaderContext, async storage, fileReader — support the fork router/runtime lanes. rstest config moved to happy-dom [M].

### sandpack-react (2 files) — [M]

Build script (node strip-types + `tsgo:dts`) and dependency alignment.

### types (7 files) — [F]

Server/CLI type surface additions: tanstack route fields (`loaderDeps`, `validateSearch`), `unsafeHeaders`, `cacheConfig`.

### utils (21 files) — mixed

- `src/cli/runtimeExports.ts` — [F] file-flush rewrite of runtime exports generation.
- `compiled/pkg-up/*` — [F] vendored compiled blob replaced with a readable reimplementation (same API).
- `src/cli/constants.ts` — [F] fork constants (`NESTED_ROUTE_SPEC_FILE`, etc.).
- rest (logger, version, require, is/get) — [M] reordering + strictness.

## packages/tsconfig (1 file) — [M]

`base.json` adds `ignoreDeprecations: "6.0"` for the TS 6 toolchain.

---

## Sync guidance

1. Resolve [M] conflicts toward upstream, then re-run `npx biome check --write` and restore `@effect-diagnostics` pragmas.
2. Keep the fork side for everything [F]; diffs inside upstream-owned files are intentionally minimal — if a conflict looks large, check whether the logic should move to a fork-owned module instead.
3. [U] items shrink this ledger: PR them upstream (render.ts matchRoute first) and drop the entry once merged.
