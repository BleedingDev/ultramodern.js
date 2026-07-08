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
