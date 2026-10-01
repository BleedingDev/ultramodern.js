# Dependency refresh for one UltraModern release

Researched on 2026-10-01 against `4d606d0203fe4c67585cbff5d3f72a0e80de402f`. Research task `modernjs-s2xwc`; implementation epic `modernjs-h8xqq`. Dependency files have not been changed.

## Recommendation

Ship one coordinated UltraModern version after upgrading and validating dependency cohorts in separate internal commits. Effect 4.0.0 is the main runtime change. Include the security repairs, current Rstack and Module Federation releases, pnpm 12, Changesets 3, current testing tools, generator projections and packed-consumer proofs in that same release. Intermediate commits and local candidate packs are useful for diagnosis; none is a public framework release.

Use the newest supported stable version for active dependencies. Explicitly record exceptions for packages available only as prereleases, intentionally versioned test fixtures, incompatible third-party peers and behavior-changing dependencies. Do not downgrade existing qualified prereleases because their `latest` tag points to an older stable branch. Do not treat the numerically highest published version as supported: this registry contains withdrawn releases, maintenance tags and next-channel versions without a prerelease suffix.

## Coverage and evidence

The tracked inventory contains 269 manifests and 2,507 dependency/dev/peer/optional declarations. Adding workspace overrides, generator constants, resolved generator policy aliases and sidecar recipes gives 2,677 declarations across 437 dependency identities. Registry checks covered every identity and its consumers, declared ranges, engines and peers. Raw results remain outside the repository in `~/.codex/research/modernjs-dependency-refresh-20261001/`.

The lockfile contains 196 importers, 2,982 package records and 2,421 distinct package names. 431 names resolve to multiple versions. The external research cache contains the complete resolved package/version inventory. All lockfile records were included in `pnpm audit --json`; registry latest-version lookups cover declared dependencies, policy/recipe dependencies and additional affected security packages, rather than making unsupported claims that every transitive dependency can be independently upgraded.

Registry data came directly from `https://registry.npmjs.org/<encoded-name>`. For packages where `latest` differs from the highest non-prerelease version, metadata for the exact `latest` version was fetched separately. `highestNonPrereleaseMetadata` retains the other version's metadata. Missing registry entries are local workspace names, alias labels or synthetic fixture names; they are not failed external dependency checks. Internal `@modern-js/*` references stay local. Updating to npm's upstream Modern.js 3.9.3 is a separate upstream rebase, outside this refresh.

The repository dependency-audit script was run with `--skip-user-app-install`. It recursively reported 988 manifests and 13,926 sources because it included nested worktrees and generated output. Its phantom-import and cycle findings need tracked-file confirmation before becoming fixes. No generated-app install, install-time measurement, dependency implementation, build or framework acceptance was performed in this research task. The existing Node policy requires at least 26.7.0 and pnpm is pinned to 11.27.1.

## Main version targets

These are the versions observed during research. Refresh once at implementation start, freeze the exact matrix, then stop chasing new tags during acceptance.

| Cohort | Current | Research target | Main check |
| --- | --- | --- | --- |
| Effect / OpenTelemetry adapter | 4.0.0-rc.117 | 4.0.0 / 4.0.0 | Imports, schemas, RPC, HTTP and Worker bundles |
| Effect diagnostics tooling | @effect/tsgo 0.45.0 | 0.47.2 | TypeScript 7 diagnostics and generated tooling |
| TanStack React Router / core | 1.170.39 / 1.171.32 | 1.170.41 / 1.171.34 | Navigation, prefetch, localized URLs and federation |
| TanStack history | 1.162.4 | Keep 1.162.4 | Respect independently versioned package dependencies |
| Rsbuild / Rspack | 2.2.9 / transitive | 2.2.11 / 2.2.8 | Compiler, plugins, CSS, lazy compilation and RSC |
| Rslib / Rspress | 1.0.2 / 2.0.22 | 1.0.3 / 2.0.23 | Declaration output and documentation build |
| Rstest | 0.11.12 | 0.12.3 | Adapter, browser tests, config and runner behavior |
| Module Federation / node | 2.9.1 / 2.7.51 | 2.9.2 / 2.7.52 | Patch retirement, DTS, CSR/SSR and sidecar aliases |
| Hono | ^4.13.8 | 4.13.12 | Error, body, streaming and generated BFF clients |
| pnpm | 11.27.1 | 12.8.1 | Install, lockfile, pack, publish staging and config parity |
| Node | 26.7.0 | 26.10.0 | Native binaries, Node policy, CI and generated toolchain |
| Changesets CLI | ^2.31.1 | 3.0.3 | Existing fixed group and release scripts |
| Biome / oxfmt | 2.5.3 / 0.66.0 root, 0.70.0 generator | 2.5.15 / 0.71.0 | Config, hooks and root/generator parity |
| oxlint / ultracite | 1.85.0 / 7.12.0 | 1.86.0 / 7.12.2 | Current presets and peer requirements |
| Vitest example | ^4.1.11 | 5.0.3 | Explicit Vite peer and changed mock defaults |
| Wrangler / Workers types | 4.137.0 / 5.20260923.1 | 4.145.0 / 5.20261001.1 | Real Worker runtime and package cohort |

React and React DOM 19.3.0, Tailwind 4.3.3, TypeScript 7.0.2, Nx 23.2.1, i18next 26.4.2, react-i18next 17.0.15 and Zod 4.6.5 are already current stable. Normalize active producer pins without turning broad published peer contracts into untested exact claims. Type packages and older active examples still need alignment.

`@effect/tsgo` is independently versioned tooling, not a runtime package that should receive version 4.0.0. Likewise, Module Federation node and TanStack history/core have their own published versions. The dependency relationships decide cohort alignment.

## Effect stable is an API update

The project already uses v4 APIs. A wholesale v3 migration would add unnecessary work. The stable release does require changing `effect/unstable/http` to `effect/http`, `effect/unstable/httpapi` to `effect/http-api`, and `effect/unstable/rpc` to `effect/rpc`. Old paths have no compatibility exports. Remove the obsolete path contracts in framework code, templates, tests and re-exports together. The relocated APIs can still change in minor releases, so exact platform pins remain appropriate. [Effect migration guide](https://github.com/Effect-TS/effect/blob/main/MIGRATION.md)

Current consumers include `packages/server/bff-effect/src/effect-client/`, `src/effect/handler/`, `src/assembly.ts`, CLI BFF extensions and generated HTTP/RPC source under `packages/toolkit/ultramodern-create/src/ultramodern-workspace/api/`. Brands in `microvertical-api.ts` already use concrete string identifiers. Audit schema representation and decoding, cancellation and cleanup, encoded RPC interruption, socket failures and tuple-returning partition calls against the RC-to-stable changes; add tests only for behavior this framework actually uses. Effect's stable requirements include TypeScript 5.9+, and its Vitest integration requires Vitest 5. [Effect 4.0.0 release](https://github.com/Effect-TS/effect/releases/tag/effect%404.0.0)

The npm tarballs for RC.117 and stable were downloaded and SHA-512 checked against registry metadata. Stable exposes `./http`, `./http-api` and `./rpc`, and has no old `./unstable/http` export. Its `dist/http/FindMyWay/internal/router.js` uses assignment and contains zero `new Function` constructors; RC.117 contains one. Stable integrity is `sha512-ooc1TG5t+FfzgYnFz2ff6BBKyZ7EwBRVXC7c4RhQUAD6/TZ2gTXXMeb4WX7a19ozQo4J73/QW+S00YAIresoMQ==`.

Retire `patches/effect@4.0.0-rc.117.patch` and its inventory entry after a Worker execution and no-code-generation bundle test proves equivalence. Because the Effect sidecar exists only for this repair, prefer ordinary upstream `effect@4.0.0` consistently in generated app dependencies, publication aliases and runtime peers. Remove the sidecar recipe only after verifying every producer projection; do not leave a stale `npm:@bleedingdev/effect` reference or duplicate Effect identity.

## Build, federation and corrected artifacts

Module Federation 2.9.2 includes the `ResourceLoadContext` import fix, plus `adm-zip` 0.6.1 and `undici` 7.29.1. Our runtime-core patch is therefore a retirement candidate. The remaining five federation patches still require comparison with exact 2.9.2 tarballs and behavior proofs. A patch applying cleanly is insufficient evidence that it is needed or correct. [Module Federation 2.9.2](https://github.com/module-federation/core/releases/tag/v2.9.2)

`patch-inventory.ts` owns applicability and hashes; `scripts/ultramodern-supply/sidecars.json` owns authenticated upstream inputs and allowed alias rewrites. Update canonical recipes and patch bytes, regenerate with `sync-patches.mjs --write`, then run reconstruction verification. Generated workspaces must continue to receive corrected packages without local framework patches. Preserve Zod's Worker code-generation protection while it remains necessary. Refresh image sidecars through the producer, rather than silently reverting to upstream IPX's Sharp ^0.34.3.

Rsbuild, Rslib and Rstest targets depend on the same Rsbuild 2.2.11 cohort. Rstest 0.12 changes its JavaScript API and adds new execution pools; test the existing Modern adapter and root runner before changing pools. [Rstest 0.12 announcement](https://rstest.rs/blog/announcing-0-12)

The repository already uses Rspack 2. Use its migration guide to audit touched compiler/plugin options and the optional runtime-tools peer, rather than performing a redundant v1 migration. Check build statistics used by federation manifests, loader targets, lazy compilation, CSS ownership and chunk loading. [Rspack migration reference](https://www.rspack.dev/guide/migration/rspack_1.x)

## Tooling and other major changes

Treat pnpm 12 and Changesets 3 as release-tooling changes with their own dry-run proof. pnpm 12 is the Rust CLI, whereas this repository pins the JavaScript CLI. Exercise settings relied on by generated workspaces, aliases, patches, lifecycle build policy, filtering, local packs and publication preparation. Target `latest` 12.8.1, not numerically higher `next-12` 12.8.2. Preserve the repository's task scheduler and serialized install policy. [pnpm release history](https://pnpm.io/blog)

Upgrade Changesets libraries with its CLI: read 1.0.1, config 4.0.1 and assemble-release-plan 7.0.0 are relevant declared targets. Read the exact tagged changelogs and verify this repo's scripts before landing. Keep the existing `@modern-js/*` fixed release group and publication remapping; the next framework version comes from the current release stream, not this research date.

Other active major candidates include Jest/babel-jest/jsdom, Cypress, testing-library jest-dom, Mermaid 12, ioredis 6, type-is 3, es-module-lexer 3, SWC loadable-components 14, Chalk 6, Execa 10, Nano ID 6 and dotenv 18. The complete consumer lists identify whether each change affects the release tooling, examples, server runtime or prebundled utilities. Upgrade parser/transform/test adapters as compatible sets. SWC plugin ABI and ESM/CJS execution need explicit verification. Do not convert the whole suite to a new testing framework merely because Rstest adds E2E support.

Vitest 5 makes Vite a peer and changes mock clearing and inline project inheritance. This repo disables automatic peer installation, so explicitly declare a compatible Vite in the Vitest example. Verify test setup and mock lifecycle under the new defaults. [Vitest migration guide](https://vitest.dev/guide/migration/)

Prebundled utilities are dependencies too. Change `scripts/prebundle/package.json` and its authoring inputs, then regenerate `packages/toolkit/utils/compiled/**` with the existing producer. Never hand-edit compiled manifests or output. Replace deprecated `pkg-up` with supported `package-up` only after checking its sync/async export contract and project-root callers. Remove stub `@types/cookie`, `@types/glob`, `@types/signal-exit` and `@types/url-join` where the installed implementations supply types.

`dotenv-expand@1000.0.0` adds automatic command substitution and encryption, and changes empty/unset expansion semantics and licensing. The version jump is intentional. Require a concrete policy for shell execution and environment precedence before adoption; preserve literal command-like values unless execution is intentionally authorized. If the latest API cannot retain that contract, select a supported replacement at the owning framework layer and record its disposition. This is a release blocker to resolve, not permission to skip silently or add an app shim. [dotenv-expand changelog](https://github.com/dotenvx/dotenv-expand/blob/master/CHANGELOG.md)

Keep the supported package tags for `nock`, `koa-compose` and `react-server-dom-rspack`. Their numerically higher historical versions are deprecated or accidentally published. `h3`'s latest tag is an RC; use supported stable 1.15.11 for the current IPX lane. Some tags are behind existing declarations, including Babel parser and postcss-initial. Resolve those using compatible cohort releases without blindly downgrading. Do not globally force React Router 8: the federation bridge currently declares a v7 peer, while active dev-server paths use v8. Bring each required major to its secure supported version.

## Security repair scope

The audit returned 44 advisories: 22 high, 16 moderate and 6 low, no critical. These are registry findings, not proof that each affected code path is exploitable. The external research cache retains advisory IDs, fix ranges and representative consumer paths. Re-run the audit before implementation.

| Dependency | Resolved affected version | Minimum fixes observed | Owning path |
| --- | --- | --- | --- |
| sharp | 0.34.5 | >=0.35.4; current 0.35.5 | image/IPX dependencies and corrected sidecars |
| adm-zip | 0.6.0 | >=0.6.1 | federation DTS tooling |
| undici | 7.29.0 | >=7.29.1 | federation DTS and other HTTP consumers |
| brace-expansion | 1.1.18, 2.1.4, 5.0.9 | >=1.1.21, >=2.1.7, >=5.0.12 | minimatch/glob and existing override selectors |
| engine.io | 6.6.9 | >=6.6.10; current 6.6.11 | Rsdoctor/socket.io |
| axios | 1.18.1 | >=1.20.0 | Nx and other dependency paths |
| serialize-javascript | 7.1.1 | >=7.1.2 | framework runtime-utils and published consumers |
| dompurify | 3.4.15 | >=3.4.16 | Mermaid/documentation |
| elliptic | 6.6.1 | No published fix | Storybook Node crypto polyfill |

Prefer updated parent packages. Add or adjust a narrowly scoped override only where the parent remains stale and the target is compatible. Preserve separate brace-expansion majors for their actual consumers; existing security floors are now stale. Remove the unneeded Storybook crypto polyfill if confirmed unused. Otherwise document actual reachability and disposition for elliptic, without inventing a nonexistent fixed version. Finish with audits of the final repo lockfile and independent packed consumer installs.

## Generator, release-age policy and acceptance

`versions.ts` and `policy.ts` feed templates, producer pins, aliases and toolchain declarations. Refresh all those projections together. Comments claiming the BFF pins still belong in `packages/cli/plugin-bff/package.json` are stale: current optional Effect peers also live in fork-owned build extensions. Comments saying generated workspaces carry no active Effect patch coexist with a corrected Effect alias. Update the comments to the final supported contract.

Wrangler 4.145.0 depends on Miniflare `5.20260930.0-alpha` and workerd `1.20260930.2`. The registry also publishes workerd `1.20261001.1`. Verify the Wrangler cohort and direct workerd override together rather than assuming all daily versions are interchangeable. Miniflare's current latest is an alpha and its last non-prerelease is older v4. Keep the qualified v5 contract unless an independently verified stable replacement exists; do not downgrade. Cloudflare's compatibility date is a behavior switch, not a package version. Change it only with a separate behavior proof.

Generated workspaces enforce a 24-hour minimum release age, strict missing-time behavior, no-downgrade trust, build allowlists and explicit installs. Effect stable was published at `2026-10-01T03:11:28.537Z`. Its initial ordinary generated install can pass the age rule after `2026-10-02T03:11:28.537Z`, unless the existing reviewed release-age mechanism permits an exact exception. Fresh corrected sidecars have their own publication age. Prefer waiting rather than weakening the policy.

Acceptance must cover HTTP/RPC on Node and Workers, SSR streaming and hydration, RSC, localization, router prefetch/navigation, Module Federation remote recovery, DTS and native compiler paths, image sharpening, generated app install/build/test, and packed package exports. Benchmark changed bundle sizes and install size/timing against the baseline; explain material regressions rather than claiming an unmeasured improvement.

`/Users/satan/side/experiments/tractor-store-vertical` was absent during research. Recheck at implementation time. If it exists, update and validate it against the candidate release as mandatory downstream acceptance, preserving the Tractor UI.

No additive subsystem belongs in an upstream-owned package. Every non-shrink edit to upstream-owned lines requires the reviewed implementation route and same-PR `FORK-DIVERGENCE.md` owner/reason/disposition evidence. Run the canonical fork boundary gate against `eded841256`; never change measurement scope to make the upgrade pass.

## Execution handoff

The seven executable plans and dependency graph are in [the plan directory](../../../.codex/plans/dependency-refresh-20261001/README.md). Beads owns progress and blocking relationships. The plan frontmatter is the graph projection; all implementation tasks remain pending. Baseline freezes the matrix, tooling establishes a usable runner, Effect/build/runtime updates follow, generator integration joins them, and acceptance gates one release. Review the target matrix and unresolved behavioral choices before execution. This request authorizes research and planning, not dependency implementation or npm publication.
