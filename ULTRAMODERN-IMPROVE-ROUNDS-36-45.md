# UltraModern fork — /improve-codebase campaign, Rounds 36–45

Continues rounds 26–35 (`ULTRAMODERN-IMPROVE-ROUNDS-26-35.md`). Same scope
rule: **only fork-added / fork-owned code** (diff vs merge-base `8a744c1b` /
`origin/main` = vanilla web-infra-dev/modern.js). Vanilla-derived lines never
touched — upstream-merge compatibility preserved.

Leader/analyst/verifier: Claude Code Fable 5. Coding lane: Codex GPT-5.5
(`codex exec -p ecosystem`), independently verified by leader (diff read +
build + tests re-run) before every commit. Analysis: TraceDecay code-graph
(redundancy, complexity, dead_code) + custom detectors (over-export,
unused-dependency, dead-file, definition-only symbol).

---

## Round 36 — type-hardening lane closure (plugin-i18n, plugin-tanstack)

Commit `ff822c4b76`. Verified + committed the parallel hardening lane left
uncommitted since R28: **~25 `any` casts replaced with typed shapes** across
5 files — `DetectorCleanupInstance`, `MergedBackendOptions`, typed
`I18nWrapperInstance` guard (`isI18nWrapperInstance` is now a proper type
predicate), `RouteExtras` for CLI route codegen, recursive `ResourceValue`.
Also synced `pnpm-lock.yaml` for the deleted `bff-runtime-parity` importer.
Both packages: build (tsgo dts) exit 0, test suites green.

## Round 37 — plugin-i18n de-export sweep (19 symbols)

Commit `a2ac400d4b`. Over-export detector (symbols in non-entry files, no
barrel re-export, 0 external refs incl. docs) — plugin-i18n was the one fork
package R31–35 never swept. **19 internal-only symbols de-exported** across
9 files (context, contextHelpers, instance, pluginSetup, providerComposition,
routerAdapter ×6, shared/detection, shared/utils, cli/locales).
Build + tests green. (Codex lane hung on stdin for this round — leader
applied the mechanical edits directly; stdin fix `</dev/null` used for later
delegations.)

## Round 38 — fork script families dedup (Codex lane, −304 lines)

Commit `716c1e3e23`. Codex GPT-5.5 deduplicated **8 copy-paste helpers** into
shared modules, leader re-ran all acceptance tests independently:
- `scripts/skills/dependency-audit/scripts/lib/size-kit.mjs` — findLockfile,
  findInstallRoot(climb), dirSize, parseStoreEntry, measureInstalled, mb
  shared by `audit.mjs` + `size-audit.mjs`.
- `ultramodern-publish/lib/direct-run.mjs` (isDirectRun ×2 unified),
  `fs-utils.mjs` (collectPackageJsonFiles ×2), `option-syntax.mjs`
  (rejectInlineOptionSyntax ×2, parameterized by option sets).
- Bonus: fixed **latent broken `../../../../lib` import depth** in
  prepare-bleedingdev-packages `commands.mjs`/`constants.mjs` (real bug,
  surfaced by the acceptance tests).
`pnpm test:scripts` 72/72, publish `__tests__` green, size-audit smoke OK.

## Round 39 — unused-dependency audit (12 removals)

Commit `f8eb8aff68`. Detector: dep declared but never imported/required in
package src/tests/configs; every candidate verified against vanilla
package.json so only **fork-added** deps were touched:
- plugin-bff: **8 unused `@opentelemetry/*` SDK packages** (only
  `@opentelemetry/api` is actually imported; all 8 absent upstream).
- plugin-i18n: `@modern-js/utils` dep + `ts-node` devDep.
- plugin-tanstack: `@testing-library/dom` devDep.
- create-request: `happy-dom` devDep (fork-added).
Oracle catch: `oxlint` in code-tools looked unused but is loaded via
`require.resolve('oxlint/package.json')` — test suite failed, dep restored.
Vanilla-derived unused deps (create-request `encoding`, `@modern-js/utils`)
deliberately left — removing them would add merge-conflict surface.

## Round 40 — cross-file dedup + node: protocol normalization (14 fixes)

Commit `3fdb71d8d3`. `toTanstackPath` existed twice in plugin-tanstack
(cli/tanstackTypes/shared.ts vs runtime/routeTree/paths.ts, AST-identical) —
cli now re-exports from the runtime module. **13 bare `fs`/`path` builtin
imports normalized to `node:` protocol** across 9 fork files in
plugin-i18n / plugin-tanstack / runtime-extensions, matching the convention
the rest of the fork already uses. 3 packages build + test green.

## Round 41 — dead code in toolkit/create (7 fixes)

Commit `ba8f577ef6`. File-level dead-file detector + definition-only symbol
scan:
- **Deleted `ultramodern-workspace/pnpm-workspace-policy-plan.ts` (174
  lines)** — zero importers anywhere.
- Cascade removal of orphans: `hashTemplateTree`, fs-io's `hashFile`
  (generation-result.ts has its own private copy), 
  `createModernPackagesMetadata`, `UltramodernModernPackagesMetadata`,
  `modernPackageAliases`; `modernAliasPackageName` de-exported.
create build (tsgo dts) exit 0, full codegen-snapshot test suite green.
Notable non-findings kept honest: `plugin.worker.tsx` / `*.node.ts` are
environment-suffix variants (alive); cloudflare `templates/*.mjs` are
loaded by explicit name list (alive); ambient `.d.ts` loaded via tsconfig.

## Round 42 — dead fork symbols inside vanilla packages (4 fixes)

Commit `bcfd095966`. New surface: **450 fork-added source files living
inside vanilla packages** (plugin-runtime, app-tools, builder, server/core,
bff-core…) — never swept in any prior round. Definition-only scan:
- `withRouterCleanup` (plugin-runtime routerCleanup.ts) — dead wrapper;
  callers use createRouterCleanup/runWithRouterCleanupOnError directly.
- `buildSSRLazyCompilationTest`, `planSSRLazyCompilation` (app-tools
  lazyCompilation.ts) — unused legacy aliases of renamed functions.
- `AdapterParityResult` (bff-core adapter-kit/parity.ts) de-exported —
  not re-exported by the adapter-kit barrel, 0 external refs.
False positives correctly excluded: `renderServerComponent` (public
`./runtime/rsc/server` entry), `__modernjsBackendFederation` (codegen
template string, not a real module export).
runtime + app-tools + bff-core build + test green.

## Round 43 — de-export sweep, toolkit/create round 2 (69 symbols)

Commit `21c8927083`. Codex GPT-5.5 lane (stdin-fixed delegation), leader
re-ran build + tests and audited the diff (pure export-keyword removals,
19 files). **69 internal-only symbols de-exported** across mf-validation,
add-vertical preflight/plan, cli/flags, codesmith, app-files, locales,
fs-io, naming, package-json, policy, prompts, package-source.
Oracle catch (again): `WorkspaceRootScriptPlan` TS4058 inferred-return
usage → kept exported, same exclusion R35 hit. 142 tests green.

## Round 44 — de-export sweep, fork files inside vanilla packages (29 symbols)

Commit `bc47af47cb`. Same detector over the remaining fork-added files in
vanilla packages: plugin-runtime (`RuntimeRequest`/`RuntimeResponse` in
context/public, `getMatchedRouteAssets`), server/core static plugins
(staticModuleFederation, staticPrecompressed), server/utils importRewriter,
app-tools cloudflare deploy verifier + security-policies + lazyCompilation
types, code-tools oxlint ast, runtime-utils sanitize. Exclusions honored:
`plugin-bff` `edge.ts` (export*-chained public API, per R32),
`hydrateTanstackRouter`/`loadTanstackRscPayload`/`renderServerComponent`
(consumer entry points, per R31), codegen template identifiers.
6 packages build (tsgo dts) + test green.

## Round 45 — plugin-i18n detection/backend type hardening (~30 any)

Commit `ed5b8f31d4`. Codex GPT-5.5 lane, leader-verified (build + tests
re-run, diff audited for behavior changes — none). **~30 `any` casts
eliminated** across detection middleware (node + common), detection
types/detector, backend middleware, server redirectPolicy, hooks,
contextHelpers — replaced with `I18nInstance`-derived shapes, typed local
interfaces (`LocaleRedirectRequest`, `MutableDetectorInstanceState`), or
`unknown` + narrowing. 0 `any` remaining in the 8 scoped files.
88/88 tests green.

---

# Campaign summary — Rounds 36–45 (10 full iterations)

| R | Commit | Fixes | Theme |
|---|---|---|---|
| 36 | `ff822c4b76` | ~25 | any→typed lane closure (i18n/tanstack) + lockfile sync |
| 37 | `a2ac400d4b` | 19 | de-export plugin-i18n (never swept before) |
| 38 | `716c1e3e23` | 10 | scripts dedup −304 lines + latent import-depth bug (Codex) |
| 39 | `f8eb8aff68` | 12 | unused fork-added deps (8× OTel in plugin-bff) |
| 40 | `3fdb71d8d3` | 14 | toTanstackPath dedup + node: protocol ×13 |
| 41 | `ba8f577ef6` | 7 | dead file (174L) + orphan cascade in create |
| 42 | `bcfd095966` | 4 | dead fork symbols inside vanilla packages |
| 43 | `21c8927083` | 69 | de-export create round 2 (Codex) |
| 44 | `bc47af47cb` | 29 | de-export fork-files-in-vanilla-packages |
| 45 | `ed5b8f31d4` | ~30 | plugin-i18n detection cluster de-any (Codex) |

**~219 fixes across 10 build+test-gated rounds**, all fork-owned code,
vanilla-derived lines untouched, upstream-merge compatibility preserved.

**New surface unlocked this campaign:** the **450 fork-added source files
living inside vanilla packages** (plugin-runtime, app-tools, builder,
server/core, server/utils, bff-core, runtime-utils) — enumerable via
`git diff --name-status -M 8a744c1b HEAD -- packages | grep '^A'`. R31–35
only swept the six standalone fork packages; this surface yielded ~100
de-exports + dead symbols in R42–44.

**Detector traps logged (kept the campaign honest):**
- `require.resolve('pkg/…')` invisible to import-grep (oxlint dep — test
  oracle caught the bad removal, reverted).
- imports written *with* `.ts` extension (code-tools) defeat basename-grep.
- env-suffix modules (`plugin.worker.tsx`, `*.node.ts`) are bundler-resolved
  — never dead by grep.
- codegen template identifiers look like exports but are emitted strings.
- `codex exec` hangs reading stdin when non-interactive — append `</dev/null`.
- background-subshell detector runs can silently mis-count — spot-check
  before acting (one whole result set discarded in R42).

**Still owner-gated (unchanged from R30):** retiring the ~2k-LOC opt-in
telemetry/canary/contract-gate cluster — plan R-T1…R-T5 in the R26–35
report. This remains the single largest deletion lever and needs product
sign-off.
