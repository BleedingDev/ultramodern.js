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

Status: IN PROGRESS (delegated to codex gpt-5.5, verifying).

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
