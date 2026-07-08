# RFC-0002: AI-First Framework and MCP/CLI Parity Plan

- Status: Retired (2026-06-12) — implementation was removed; Module Federation is the live composition runtime, while Garfish/trust-contract/Wave 0 lanes are historical (see `FORK-DIVERGENCE.md`).
- Date: 2026-02-26
- Scope: Modern.js framework-level AI-first operator and tooling contracts
- Depends on:
  - `RFC-0001-super-app-foundation-plan.md`
  - `ADR-0004-telemetry-standardization-and-exporters.md`
  - `ADR-0002-app-level-mf-ssr-strategy.md`
  - `ADR-0009-mcp-cli-capability-parity.md`

## 1. Summary

This RFC defines how Modern.js evolves into an AI-first framework without introducing a disruptive rewrite:

1. expose machine-readable runtime state as stable contracts.
2. make operational capabilities available through both MCP and CLI surfaces.
3. keep reliability/performance measurable under failure, jitter, and fallback paths.
4. preserve upstream and migration compatibility while tightening defaults for automation and trust.

## 2. Goals

1. Ship a runtime status/graph contract for live MF and BFF systems.
2. Make every MCP capability executable from CLI with equivalent schema and semantics.
3. Improve operability for coding agents and CI bots with deterministic machine-readable outputs.
4. Add first-class resilience benchmarking for MF fallback latency, remote jitter, and BFF degradation behavior.
5. Keep future off-main-thread experiments out of release scope until a fresh design and proof package exists.

## 3. Non-Goals

1. Rewriting the framework into a worker-first architecture.
2. Replacing human operation workflows with autonomous mutation in production.
3. Locking core behavior to a single external MCP/CLI bridge implementation.
4. Expanding framework scope into domain-specific business orchestration.

## 4. AI-First Definition (Modern.js)

For Modern.js, AI-first means:

1. contracts are machine-readable first, human-readable second.
2. runtime and release state are introspectable without reverse engineering.
3. operator interfaces are deterministic and scriptable across transport surfaces (MCP, CLI, CI).
4. sensitive operations are explicit, auditable, and policy-bound.

## 5. Workstreams

### Workstream A: Runtime Introspection Contract

Deliver versioned read-only resources for:

1. MF remote resolution and compatibility state.
2. BFF producer binding/runtime compatibility state.
3. trust and contract-gate violation snapshots.
4. telemetry queue and exporter health summary.

### Workstream B: MCP/CLI Capability Parity

Adopt a capability registry so every capability is defined once and surfaced consistently through:

1. MCP tools/resources.
2. CLI commands with machine-readable output mode.
3. CI validation and parity reporting.

### Workstream C: Resilience Benchmarking as First-Class Artifact

Add dedicated benchmarking lanes separate from functional tests:

1. remote fetch timeout/jitter degradation.
2. fallback activation latency and correctness.
3. BFF partial failure and retry/degrade behavior.
4. trust violation handling under load.

### Workstream D: Retired Worker-Lane Track

The earlier worker-lane pilot is retired. Any future off-main-thread proposal must restart with a new design, implementation owner, and proof package for:

1. diff-heavy data transforms.
2. large grid/chart aggregations.
3. optional OffscreenCanvas rendering lanes.

No release artifact may claim worker-lane support until that new package exists. Future lanes would require deterministic fallback to main thread and explicit telemetry hooks.

## 6. Risks, Harm, and Mitigations

1. Risk: exposing runtime topology leaks sensitive deployment details.
   - Mitigation: auth + redaction + environment gating + audit logs.
2. Risk: MCP/CLI drift creates automation bugs.
   - Mitigation: single capability registry + parity conformance tests.
3. Risk: naive bridge-based parity introduces shell/streaming edge-case failures.
   - Mitigation: bridge for bootstrap only, native handlers for hot/high-risk paths.
4. Risk: retired worker-lane plans leave stale rollout assumptions in automation.
   - Mitigation: keep the fallback-signal endpoint/CLI path, and require new worker-lane proposals to ship fresh implementation, locking, and tests before documentation claims support.
5. Risk: benchmarks provide false confidence if disconnected from production behavior.
   - Mitigation: combine synthetic scenarios with production-shaped traces and nightly runs.

## 7. Gate Alignment

1. Gate A: architecture scope must include operator-surface trust and rollback notes.
2. Gate B: implementation proof includes parity contract evidence and endpoint/command behavior.
3. Gate C: testing proof includes parity conformance and resilience benchmark results.
4. Gate D: final review includes at least two independent reviewer records with residual risk handling.

## 8. Phased Rollout

1. Phase D1:
   - runtime status/graph schema v1.
   - capability registry v1.
   - MCP bridge + adapter artifacts generated from capability contract.
   - runtime fallback signal endpoint and CLI path; the earlier worker-lane pilot is retired.
2. Phase D2:
   - CLI parity for all read-only MCP capabilities.
   - MCPorter bridge enabled for bootstrap lanes.
3. Phase D3:
   - parity for guarded mutating operations.
   - benchmark and parity reports wired into release gates.
4. Phase D4:
   - any future selective worker lanes require a new design/proof package before promotion.

## 9. Success Metrics

1. 100% MCP capability parity coverage in CLI report.
2. Zero unresolved schema drift between MCP and CLI in release-candidate checks.
3. MTTR reduction for MF/BFF runtime incidents (tracked from runtime graph adoption).
4. Measured reduction in fallback latency regression escape rate.
5. No unaudited privileged operation surface in AI/CLI tooling.
