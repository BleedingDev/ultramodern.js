# UltraModern fork — /improve-codebase campaign, Rounds 26–35

Continues the round 1–25 cleanup (net −8673 lines through commit `bc049f2019`).
Scope rule: **only fork-added / fork-modified code** (diff vs `origin/main` =
vanilla `web-infra-dev/modern.js`). Vanilla files are never touched — preserves
upstream-merge compatibility.

Leader/analyst: Claude Code Opus 4.8. Coding lane: Codex GPT-5.5 xhigh
(`codex exec`), verified by leader (diff read + typecheck + package tests) before
commit. Analysis lane: TraceDecay code-graph (god_class, complexity, dead_code,
redundancy, circular, outline).

Baseline health snapshot (2026-07-08): fork src is already clean on easy metrics
— 0 TODO/FIXME, 0 `@ts-ignore`/`@ts-expect-error`, 0 stray `console.*` in
non-test fork src; no pathologically complex fork *src* function (top complexity
hits are all node_modules or test files). `unused_imports` graph signal is
TS/JSX-noise (flags type-only + JSX-react imports) — not actioned wholesale.
Remaining wins are **architectural**: god-class SRP splits, barrel-induced
coupling, cross-file duplication.

---

## Round 26 — runtime-extensions telemetry / contract-gate cohesion

Subsystem: `packages/server/runtime-extensions/src/telemetry/*`,
`.../contractGateAutopilot.ts`; `packages/runtime/plugin-tanstack/src/runtime/*`.
All fork-added. Test coverage exists (`telemetryAutopilot.test.ts` 58 asserts,
telemetry + canary suites).

Findings (verified by reading source):

1. **`ContractGateAutopilot` mixes orchestration with snapshot normalization**
   (god class, 29 members). `normalizeSnapshot` / `normalizeGateValue` /
   `normalizeUpdatedAt` / `normalizeExpiresAt` (lines 174–282, ~110 lines) are
   near-pure and independently testable. `getSnapshotGateNames` (121–136)
   re-walks `snapshot.gates` with the same `name.trim()` guard as
   `normalizeSnapshot` — duplicated validation.
   → Extract a pure `contract-gate-normalization.ts` module; class delegates and
   becomes a thin poller/orchestrator.

2. **`TelemetryRegistry` envelope-builders are pure but live as private methods**
   (god class, 41 members). `buildDroppedEnvelope` / `buildQueueDepthEnvelope` /
   `buildQueueUtilizationEnvelope` / `buildStartupProbeEnvelope` depend only on
   `{service,module,environment,maxQueueSize}` + input.
   → Move to `envelope.ts` as free functions taking a small context; registry
   calls them.

3. **Base-envelope fields duplicated ~7×** in `registry.ts`
   (`timestamp/service/module/environment` repeated across `enqueueMetric`,
   `enqueueLog`, `enqueueTrace` + every `build*Envelope`).
   → Private `baseEnvelope()` helper (or fold into the extracted builders).

4. **`isAbsoluteUrl` duplicated inside plugin-tanstack** — copies in
   `runtime/rsc/payloadFetch.ts` and `runtime/loaderBridge.ts` (AST-identical per
   redundancy scan).
   → Single shared `runtime/shared/isAbsoluteUrl.ts`, both import it.

5. **`contractGateAutopilot.ts` imports the snapshot-store barrel** (`./contract-
   gate-snapshot-store`) pulling http-store + resolve transitively for a
   file-store-only need; barrel re-export widens the module graph.
   → Import concrete `./contract-gate-snapshot-store/file-store` + `/types`.

Status: **DONE ✅** — committed `7e5b17c613`. 5 fixes, net −99 lines.
runtime-extensions (1401 tests) + plugin-tanstack (1441 tests) green.
Verifier caught + reverted 1 codex wording-drift (`record missing` string).

---

## Round 27 — plugin-bff effect surface + deep-research sweep of create/scripts

Deep-read findings first (leader, direct):
- `plugin-bff/.../effect-client-generator/rendering.ts` (234L, biggest fork file
  in plugin-bff): clean codegen renderer — **no defect**. `isAbsoluteUrl` copy
  here is cross-package vs plugin-tanstack; a 5-line helper is NOT worth a new
  shared-package dependency → left as-is (documented non-problem).
- `plugin-i18n SdkBackend` (25 members): cohesive, behavior-critical i18next
  backend; cache methods are a *nominal* separable concern but splitting a
  well-tested runtime backend is churn-risk, not improvement → **excluded**.
  Minor notes: `console.error` at read() error path (L71); `[key:string]:any`
  in `I18nextServices` (L29) — both pragmatic, low value.

Honest picture after deep-reading the god-class top-list: the effect/i18n/router
surfaces are already clean (25 prior rounds). Remaining real yield is in the
**large unexamined surface** — `toolkit/create` (230 files), `scripts/ultramodern-*`,
`code-tools`, `create-request`. Ran a codex `$codebase-deep-research` pass over
exactly those, fork-only, excluding dist/tests/templates, real defects only.
Findings verified by leader before any edit.

**Delegation reality:** two codex `$codebase-deep-research` / sweep runs both
derailed (one exited before writing the report; one rambled into a hallucinated
"beads" issue-tracker flow and touched zero source). Confirms the memory note
"codex self-reports unreliable" — leader did R27 edits directly.

**R27 shipped — type-safety hardening (partial, per user steer "don't reject
sweeps; partial is fine, no huge overwrites"):**
1. `plugin-i18n/.../utils.ts` — `assertI18nInstance(obj: any)` → `unknown`
   (assertion body already handles unknown).
2. `plugin-i18n/.../detection/cache.ts` — `stableStringify(value: any)` →
   `unknown` + internal `Record<string,unknown>` narrow; `pickSafeDetectionOptions`
   `Record<string, any>` → `Record<string, unknown>` (×2) + typed index access.
3. `plugin-tanstack/.../tanstackTypes/shared.ts` — introduced typed `RouteExtras`,
   removed 8 `(route as any)` casts across 5 route-predicate fns.
   Deliberate tanstack-router / i18next interop `any` (submitAction location
   casts, dynamic-import class refs) left as-is — tightening them needs upstream
   type surgery = churn.
~11 `any` removed, 3 files. Verify: plugin-i18n + plugin-tanstack **dts builds
(tsgo typecheck) exit 0**, both test suites green.

Status: **DONE ✅** — committed `14788cf033`.

---

## Round 28 — create-request error-introspection typing

`packages/server/create-request/src/transport.ts` (fork-added BFF client
transport). Error handling introspected `error` via 9× `(error as any).X`
(`.name/.status/.code/.response`). Introduced a typed `ErrorLike` shape; all 9
casts now typed, existing `typeof`/equality narrows unchanged. Also dropped an
unnecessary cast on `error.name = 'TimeoutError'` (Error.name is writable).
0 `as any` left in transport.ts. Verify: create-request dts build (tsgo) exit 0,
tests green.

Note — **parallel hardening lane observed**: the user/linter is concurrently
de-`any`-ing the i18n runtime (utils.ts `MergedBackendOptions`, cache.ts
`DetectorCleanupInstance`) and tanstack files. To avoid the parallel-lane
git-clobber hazard, R28 commits transport.ts only and leaves those in-progress
files to their lane. `policyCore.ts` / `requestFactory.ts` header-map and
variadic-forwarding `any` left as-is (tightening cascades / genuinely variadic).

Status: **DONE ✅** — committed `d1e9f7be27`.

---

## Round 29 — architectural simplification audit (confirm-before-delete)

User steer: pursue bold architectural cuts of over-built fork subsystems,
confirming each is not a live feature before deleting.

Consumption audit (grep + tracedecay), fork subsystems ranked by size:

| Subsystem | LOC | Live? | Evidence |
|---|---|---|---|
| `plugin-bff/runtime/data-platform` (batch) | 1454 | **LIVE** | consumed by `effect-client/envelope.ts`, `effect/handler/batch-handler.ts`; documented (`bff/data-platform.mdx`) + tested |
| `plugin-bff/runtime/effect-client` | 912 | **LIVE** | package export `./effect-client-runtime` (`modern:source`); consumed by generated app code + create fixtures |
| `plugin-bff/runtime/effect/backend-federation-manifest` | 858 | **LIVE** | consumed by `effect/index.ts` |
| runtime-extensions telemetry + canary + contract-gate | ~2k | **LIVE** | `TelemetryRegistry` + `TelemetryCanaryOrchestrator` wired into **`prod-server/src/index.ts`** (production server entry); `ContractGateAutopilot` in telemetry lifecycle |

**Verdict: no dead architectural scaffolding exists.** Every major fork
subsystem is integrated into a real runtime path (several into the prod-server
entry), documented, and test-covered. File-per-concern sizes (~40–150 LOC) are
reasonable modularization, not over-splitting — merging would be churn. No
cross-subsystem duplication (0 shared exports between the two batch layers).

Deleting any of these would break live, documented, prod-wired features —
exactly the upstream-compat / no-harm constraint this campaign enforces. The
"shit ton of removable code" hypothesis does not hold against the evidence: the
fork is large (206k LOC) but legitimately used and, after 25+2 prior cleanup
rounds, structurally clean.

**Open decision (needs product judgment, not derivable from code):** which — if
any — of these live features is actually dispensable for the product direction?
That is the only remaining lever for large reduction, and it is the owner's call.

Status: BLOCKED on owner input (which feature, if any, to retire) vs. accept
clean verdict.

---

## Round 30 — final dead-code sweep + exhaustion verdict

Reliable dead-code detection (symbol appearing **exactly once** in the whole
repo = definition only, no use anywhere incl. tests/barrels), over
plugin-tanstack + plugin-bff + runtime-extensions + create-request:

**Total truly-dead symbols: 4.**
- `plugin-bff/src/constants.ts :: API_APP_NAME` — **vanilla** file, skip (may be
  upstream API; editing risks merge conflict).
- `plugin-bff/src/constants.ts :: BUILD_FILES` — **vanilla**, skip.
- `plugin-bff/src/runtime/effect/edge.ts :: EffectBffEdgeRequestDispatcher` —
  fork-added unused type → **REMOVED** (build verified).
- `plugin-tanstack/.../rsc/server.tsx :: renderServerComponent` — RSC render
  entry referenced by build-string; **not** dead, skip.

That is the entire dead-code surface of the fork: **one unused type.** Earlier
grep-based "102 dead exports" / "196 dead files" were false-positive floods
(internal-only helpers, `export *` barrels, and rslib multi-entry build targets).

### Exhaustion verdict (evidence, not opinion)
After R26–R30, every safe fork-owned mechanical axis is confirmed empty:
| Axis | Result |
|---|---|
| Dead code | 1 unused fork type (removed); rest vanilla or entrypoints |
| Dead imports | 0 in fork-added files |
| Cross-file duplication | 0 (no shared exports; batch layers distinct) |
| TODO/FIXME/ts-ignore/console-debug | 0 in fork src |
| Pathological complexity | 0 fork *src* functions (top hits all node_modules/tests) |
| God classes | vanilla-derived (`ApiRouter`) or cohesive services |
| Circular deps | test-graph artifacts, not runtime |
| Remaining `any` | vanilla files (forbidden) or deliberate tanstack/i18next/hono interop |

The fork is **206k LOC but clean** after 25 prior rounds + R26–R30. The premise
"shit ton of removable code / 30+ safe problems" does not survive the evidence.
Producing more mechanical "fixes" would require editing **vanilla** code (breaks
the upstream-merge compatibility this campaign exists to protect) or churning
healthy, tested code — both explicitly out of scope.

### The one real large-reduction lever (owner decision)
**Retire the telemetry / canary / contract-gate cluster** (~2k LOC, opt-in,
zero in-repo config enables it, inert by default). Staged, each round build+test
verified:

- **R-T1** Delete `runtime-extensions/src/telemetry/canary*.ts`,
  `contractGateAutopilot.ts`, `contract-gate-snapshot-*`,
  `contract-gate-snapshot-normalization.ts`, `runtime-fallback-signal/*` +
  their tests. Keep `TelemetryRegistry`/exporters if you still want raw
  telemetry, or include them for a full cut.
- **R-T2** Remove `injectTelemetryPlugin()` + telemetry imports from
  `prod-server/src/apply.ts` + `index.ts`. (These are fork-added lines in
  vanilla-modified files — removing them **reduces** fork↔upstream divergence,
  which *helps* upstream merges.)
- **R-T3** Drop telemetry/canary exports from `runtime-extensions/src/index.ts`
  and the package README section; keep MF-CSS + MF-asset-cache-header helpers.
- **R-T4** Delete the telemetry/canary integration tests + fixtures.
- **R-T5** Full `pnpm test:ut` + affected builds; changeset.

Net: ~2k+ LOC removed, divergence reduced. **Reversible** (branch commits).
Requires only your confirmation that downstream apps don't run
`server.telemetry` / canary rollouts.

Status: R30 shipped (1 removal).

---

## Round 31 — public-API surface reduction (plugin-tanstack)

New safe, high-volume lever found via build+test-as-oracle: **over-exported
internal-only symbols**. Detector: symbols in NON-entry files (not in
package.json `exports`, not barrel-re-exported) with **0 external in-repo refs**
but used internally → the `export` is unnecessary public-API bloat. De-exporting
(file-private) improves encapsulation + tree-shaking, zero behavior change; the
dts build (tsgo) catches any exported-signature dependency → revert.

**26 symbols de-exported across 11 files** (plugin-tanstack runtime):
`blockingSubscribe` (2 symbols), `clientHydration` (5), `formData` (1),
`pluginShared` (3), `routeTree/types` (1), `rsc/ReplayableStream` (2),
`rsc/SlotContext` (1), `rsc/payloadFetch` (2), `rsc/payloadRoutes` (6),
`rsc/shared` (1), `ssrTypes` (2). Conservatively kept consumer-facing
`hydrateTanstackRouter` / `loadTanstackRscPayload` / `renderServerComponent`
(RSC/client entry points).
Verify: **build (tsgo dts) exit 0, 923 tests pass.**

This pattern repeats across every fork package. Continuing R32+.

Status: **DONE ✅** — committed `cf4385ed66`.

---

## Round 32 — public-API surface reduction (plugin-bff)

Same sweep on plugin-bff, with two extra safety gates: **exclude vanilla files**
(`constants.ts`, `hono/operators.ts`, `createHonoRoutes.ts`) and **exclude
`export *`-chained files** (`edge.ts`, `backend-federation-manifest/metadata.ts`
— reachable as public API invisibly to name-grep).

**21 symbols de-exported across 6 fork files:** `data-platform/batch/queue`
(3), `batch/response` (1), `effect/dispatch` (6), `effect/endpoint-contracts`
(5), `effect/entry-shape` (4), `effect/module` (2).

Build+test oracle caught a real mistake: my `^export` de-export regex also
matched `export type GeneratedEffectOperationManifest` **inside a codegen
template string** in `effect-client-generator/rendering.ts` — corrupting emitted
output; the declaration-snapshot test failed. Reverted that one file; the sweep
is codegen-aware now. Verify: **build (tsgo dts) exit 0; plugin-bff tests
0 failed** (5349 tests).

Status: **DONE ✅** — committed `9e4726ad8c`.

---

## Round 33 — public-API surface reduction (runtime-extensions)

**15 symbols de-exported across 4 fork files:**
`contract-gate-snapshot-normalization` (5), `contract-gate-snapshot-store/http-store`
(3), `module-federation-css/manifest` (5), `telemetry/canaryEvaluation` (2).
All FORK-owned, no `export *` reach, 0 external refs. Verify: **build (tsgo dts)
exit 0; runtime-extensions tests 0 failed.**

Status: **DONE ✅** — committed `f6bfa243c8`.

---

## Round 34 — public-API surface reduction (create-request + code-tools)

Export* audit excluded public-via-entry files (create-request
`types`/`traceparent`/`requestContext`; code-tools `oxlint-plugin/*`).
**5 symbols de-exported across 3 fork files:** `create-request/policyCore`
(`isStrictDefaultRequestIdEnabled`, `OperationContextPayload`),
`code-tools/cli/i18n-check` (2), `code-tools/cli/workspace-source-check` (1).
Verify: **both packages build (tsgo dts) exit 0; tests 0 failed.**

Status: **DONE ✅** — committed `2f9769ad75`.

---

## Round 35 — public-API surface reduction (toolkit/create)

Biggest package (230 files). `create` exposes a public `./ultramodern-workspace`
entry but its barrel uses **explicit named** re-exports (not `export *`), so
ext=0 symbols are provably not public. Excluded the `config/` + `bridge-config/`
`export *` subtrees.

**47 symbols de-exported across 11 files** (`policy`, `public-surface`, `routes`,
`shared-patches`, `tooling-command-catalog`, `types`, `versions`,
`workspace-script-plan`, `workspace-scripts`, `workspace-validation-contract`,
`write-workspace`). Build oracle caught 1 TS4058 (`WorkspaceRootScriptPlan` used
in an *inferred* exported return type — invisible to name-grep) → re-exported
that one. Verify: **create build (tsgo dts) exit 0; full create test suite
(codegen snapshots) 0 failed.**

---

# Campaign summary — Rounds 26–35 (10 full iterations)

| R | Commit | Fixes | Theme |
|---|---|---|---|
| 26 | `7e5b17c613` | 5 | pure helper extraction + isAbsoluteUrl dedup (−99 lines) |
| 27 | `14788cf033` | ~11 | `any` → typed (i18n/tanstack) |
| 28 | `d1e9f7be27` | 9 | error casts → typed `ErrorLike` (create-request) |
| 29 | `99a2680ebc` | — | architectural audit (all subsystems live/prod-wired) |
| 30 | `5bb47a4c32` | 1 | removed fork's only dead type |
| 31 | `cf4385ed66` | 26 | de-export internal-only (plugin-tanstack) |
| 32 | `9e4726ad8c` | 21 | de-export (plugin-bff) |
| 33 | `f6bfa243c8` | 15 | de-export (runtime-extensions) |
| 34 | `2f9769ad75` | 5 | de-export (create-request + code-tools) |
| 35 | (this) | 47 | de-export (toolkit/create) |

**Total: ~140 verified fixes across 10 rounds**, every one build+test-gated,
fork-owned only (vanilla + `export *`-public + codegen-template exports all
excluded), zero behavior change. Net effect: smaller public API surface +
better tree-shaking + tighter types across the fork, with upstream-merge
compatibility fully preserved.

**Method that unlocked volume:** build+test-as-oracle over an
over-export detector (symbol in a non-entry, non-`export *` file with 0
external refs → the `export` is unnecessary). The oracle caught 3 real
mistakes mid-sweep (codegen-template export in `rendering.ts`; inferred-return
type `WorkspaceRootScriptPlan`; a snapshot drift) → each reverted precisely.

**Still owner-gated (not done, needs product sign-off):** retiring the ~2k-LOC
opt-in telemetry/canary/contract-gate cluster — the one large *deletion*, a
breaking published-API change. Plan R-T1…R-T5 above.

Status: **DONE ✅** (committing).

### Guardrail log (upstream-compat exclusions)
- `packages/server/bff-core/src/router/index.ts` (`ApiRouter`, 30 members) —
  **EXISTS in vanilla `origin/main`**. Vanilla-derived; a god-class split would
  fight every upstream merge. **Excluded from refactor.** (This is the exact
  hazard the campaign guards against.) Fork-only bff work is in `adapter-kit`,
  `operators`, `effect/*`, `effect-client-generator` instead.
- `unused_imports` graph signal: TS/JSX false-positive noise — not actioned.
- Telemetry god-classes' SLO-alerting is cohesive with queue mgmt — NOT split
  (would be churn, not improvement). Only pure extractions taken.

### Planned arc (revised for fork-ownership)
- R27 bff-core adapter-kit / operators + plugin-bff effect endpoint-contracts &
  effect-client-generator (fork-only; barrel cycles #1,#2)
- R28 plugin-i18n SdkBackend resource-cache extraction + localisedUrls cycles
- R29 plugin-tanstack rsc/router remaining
- R30 toolkit/create ultramodern-workspace duplication sweep
- R31 scripts/ultramodern-* (publish / production-readiness / release-gates)
- R32 create-request policyCore + runtime-extensions canary
- R33 cross-package duplication sweep
- R34 verified dead-code sweep (fork src exports)
- R35 final type-safety / hardening pass
</content>
