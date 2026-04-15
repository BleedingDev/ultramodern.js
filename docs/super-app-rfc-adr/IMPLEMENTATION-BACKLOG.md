# Super App Implementation Backlog

- Status: Active (Phases A/B complete, Phase C alpha, AI-first Phase D1 in progress)
- Date: 2026-02-26
- Source docs:
  - `RFC-0001-super-app-foundation-plan.md`
  - `RFC-0002-ai-first-framework-and-mcp-cli-parity-plan.md`
  - `ADR-0001-rsdoctor-default-on.md`
  - `ADR-0002-app-level-mf-ssr-strategy.md`
  - `ADR-0003-effect-only-mf-data-fetch-reliability.md`
  - `ADR-0004-telemetry-standardization-and-exporters.md`
  - `ADR-0005-cross-project-bff-hardening.md`
  - `ADR-0009-mcp-cli-capability-parity.md`

## Owner Legend

- Platform Build: framework build and bundler integration.
- Runtime Federation: module federation runtime and SSR composition.
- BFF Platform: cross-project BFF generation/runtime.
- Observability Platform: monitors, telemetry, exporters.
- QA Infra: integration tests, fixtures, CI workflows.
- AI Platform: agent-facing contracts, MCP/CLI parity, and automation surfaces.

## Epic Overview

| Epic ID | Epic | ADR | Suggested Owner | Effort | Parallelization | Depends On | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| EPIC-1 | RsDoctor Default-On | ADR-0001 | Platform Build | M | Parallel | None | Implemented |
| EPIC-2 | Cross-Project BFF Hardening | ADR-0005 | BFF Platform | L | Parallel | None | Implemented |
| EPIC-3 | Telemetry Standardization + Exporters | ADR-0004 | Observability Platform | L | Parallel | None | Implemented |
| EPIC-4 | Effect-Only MF Data-Fetch Reliability | ADR-0003 | Runtime Federation + QA Infra | L | Parallel-start, partial sequential | EPIC-2 (partial) | Implemented |
| EPIC-5 | App-Level MF SSR | ADR-0002 | Runtime Federation | XL | Mostly sequential | EPIC-2, EPIC-4 | Implemented (Alpha) |
| EPIC-6 | AI-First Runtime + Agent Surfaces | RFC-0002 | AI Platform + Observability Platform | L | Parallel-start, partial sequential | EPIC-3, EPIC-5 | In Progress |
| EPIC-7 | MCP Capability Parity via CLI | ADR-0009 | AI Platform + Platform Build | M | Parallel with EPIC-6 | EPIC-6 (partial) | In Progress |

## Progress Snapshot (2026-02-26)

- EPIC-1 complete: RsDoctor defaults are enabled in production with opt-out and non-blocking plugin defaults.
- EPIC-2 complete: cross-project BFF now enforces prefix/runtime compatibility and generated runtime/bootstrap contracts.
- EPIC-3 complete: telemetry envelope/registry plus OTLP and VictoriaMetrics exporters are in framework core.
- EPIC-4 complete: routes MF reliability and distributed trace assertions are active in both build and serve integration suites.
- EPIC-5 alpha complete: app-level MF SSR path is feature-flagged and covered by i18n MF integration tests.
- EPIC-6 in progress:
  - runtime status endpoint `/_modern/runtime/status` is implemented in framework telemetry plugin with machine-readable payload shape.
  - runtime status endpoint auth guard is wired to runtime signal auth policy when enabled.
  - runtime resilience benchmark harness is added at `benchmark/runtime-resilience` with latency percentile reporting.
  - runtime fallback signal worker-lane pilot is implemented in `@modern-js/prod-server` with opt-in `workerLane.enabled` and deterministic fallback-to-main-thread behavior.
  - worker-lane benchmark gate mode is added:
    - `pnpm run benchmark:runtime-resilience:worker-lane-gate`
- EPIC-7 in progress:
  - runtime CLI parity commands are implemented:
    - `modern runtime status`
    - `modern runtime fallback-signal`
  - capability contract and parity validator are implemented:
    - `docs/super-app-rfc-adr/contracts/ai-capabilities.json`
    - `pnpm run validate:mcp-cli-parity`
  - contract-driven MCP adapter artifacts are generated:
    - `pnpm run generate:mcp-adapter`
    - `.modern/mcp/adapter-manifest.json`
    - `.modern/mcporter.json`
  - MCP CLI bridge server is implemented:
    - `pnpm run serve:mcp-cli-bridge`

## EPIC-1: RsDoctor Default-On (ADR-0001)

| Task ID | Task | Suggested Owner | Estimate | Parallelization | Depends On |
| --- | --- | --- | --- | --- | --- |
| E1-T1 | Add framework config surface for RsDoctor default-on and opt-out | Platform Build | 1d | Parallel | None |
| E1-T2 | Wire auto plugin registration in build chain | Platform Build | 1d | Sequential after E1-T1 | E1-T1 |
| E1-T3 | Stabilize artifact output path and retention behavior | Platform Build | 1d | Parallel with E1-T2 | E1-T1 |
| E1-T4 | Add integration tests for default-on and opt-out paths | QA Infra | 1d | Sequential after E1-T2 | E1-T2 |
| E1-T5 | Update docs/migration notes | Platform Build | 0.5d | Parallel with E1-T4 | E1-T1 |

## EPIC-2: Cross-Project BFF Hardening (ADR-0005)

| Task ID | Task | Suggested Owner | Estimate | Parallelization | Depends On |
| --- | --- | --- | --- | --- | --- |
| E2-T1 | Promote prefix mismatch warning to hard validation error | BFF Platform | 1d | Parallel | None |
| E2-T2 | Add typed consumer bootstrap API (`initProducerClient`) | BFF Platform | 2d | Parallel with E2-T1 | None |
| E2-T3 | Add runtime guard for pre-bootstrap API usage | BFF Platform | 1d | Sequential after E2-T2 | E2-T2 |
| E2-T4 | Deterministic package metadata merge with collision detection | BFF Platform | 2d | Parallel | None |
| E2-T5 | Runtime compatibility verification (`hono`/`effect`) | BFF Platform | 1d | Parallel | None |
| E2-T6 | Expand watcher coverage and stale SDK detection | BFF Platform | 1d | Parallel | None |
| E2-T7 | Add regression integration tests | QA Infra | 2d | Sequential after E2-T1..E2-T6 | E2-T1,E2-T2,E2-T3,E2-T4,E2-T5,E2-T6 |

## EPIC-3: Telemetry Standardization + Exporters (ADR-0004)

| Task ID | Task | Suggested Owner | Estimate | Parallelization | Depends On |
| --- | --- | --- | --- | --- | --- |
| E3-T1 | Define canonical telemetry envelope types | Observability Platform | 1d | Parallel | None |
| E3-T2 | Introduce exporter interface and registry | Observability Platform | 2d | Sequential after E3-T1 | E3-T1 |
| E3-T3 | Implement OTLP exporter | Observability Platform | 2d | Sequential after E3-T2 | E3-T2 |
| E3-T4 | Implement VictoriaMetrics exporter | Observability Platform | 2d | Sequential after E3-T2 | E3-T2 |
| E3-T5 | Add batching, backpressure, sampling, redaction hooks | Observability Platform | 2d | Parallel with E3-T3/E3-T4 | E3-T2 |
| E3-T6 | Integration tests and perf budget checks | QA Infra | 2d | Sequential after E3-T3..E3-T5 | E3-T3,E3-T4,E3-T5 |
| E3-T7 | Telemetry docs and configuration guide | Observability Platform | 1d | Parallel with E3-T6 | E3-T2 |

## EPIC-4: Effect-Only MF Data-Fetch Reliability (ADR-0003)

| Task ID | Task | Suggested Owner | Estimate | Parallelization | Depends On |
| --- | --- | --- | --- | --- | --- |
| E4-T1 | Add unit tests for remote loader timeout/retry/contract errors | QA Infra | 1d | Parallel | None |
| E4-T2 | Add dedicated MF data-fetch integration fixture | Runtime Federation | 2d | Parallel | None |
| E4-T3 | Implement failure-injection controls in fixture | Runtime Federation | 1d | Sequential after E4-T2 | E4-T2 |
| E4-T4 | Add manifest/contract assertions for data-fetch metadata | QA Infra | 1d | Sequential after E4-T2 | E4-T2 |
| E4-T5 | Add serve-mode e2e and trace continuity assertions | QA Infra | 2d | Sequential after E4-T2/E4-T3 | E4-T2,E4-T3 |
| E4-T6 | Effect Schema-only validation and typed error assertions | Runtime Federation | 1d | Parallel with E4-T4/E4-T5 | E4-T2 |
| E4-T7 | Integrate with EPIC-2 bootstrap/runtime hardening assumptions | Runtime Federation + BFF Platform | 1d | Sequential | E2-T2,E2-T3,E4-T5 |

## EPIC-5: App-Level MF SSR (ADR-0002)

| Task ID | Task | Suggested Owner | Estimate | Parallelization | Depends On |
| --- | --- | --- | --- | --- | --- |
| E5-T1 | Define server+client dual-entry remote contract | Runtime Federation | 2d | Parallel (design phase) | None |
| E5-T2 | Define host/remote SSR manifest schema changes | Runtime Federation | 1d | Parallel with E5-T1 | None |
| E5-T3 | Implement host SSR runtime adapter for remote server entry | Runtime Federation | 4d | Sequential | E5-T1,E5-T2,E2-T2 |
| E5-T4 | Implement hydration boot payload and compatibility checks | Runtime Federation | 3d | Sequential | E5-T3 |
| E5-T5 | Implement timeout/fallback-to-CSR policy | Runtime Federation | 2d | Sequential | E5-T3 |
| E5-T6 | Add dev/serve SSR integration test matrix | QA Infra | 3d | Sequential | E5-T3,E5-T4,E5-T5,E4-T5 |
| E5-T7 | Release behind alpha feature flag and docs | Runtime Federation | 1d | Sequential | E5-T6 |

## EPIC-6: AI-First Runtime + Agent Surfaces (RFC-0002)

| Task ID | Task | Suggested Owner | Estimate | Parallelization | Depends On |
| --- | --- | --- | --- | --- | --- |
| E6-T1 | Define versioned runtime status/graph API schema for MF remotes, BFF producer bindings, compatibility, trust, and telemetry health | AI Platform + Runtime Federation | 2d | Parallel | None |
| E6-T2 | Expose read-only runtime operator endpoints and snapshot resources for CI/agents | AI Platform + Observability Platform | 3d | Sequential after E6-T1 | E6-T1 |
| E6-T3 | Unify runtime fallback signal policy between server-core and prod-server code paths | Observability Platform | 2d | Parallel with E6-T1 | None |
| E6-T4 | Add strict-mode digest flow validation between client fallback payload and server trust policy | Runtime Federation + Observability Platform | 2d | Sequential after E6-T3 | E6-T3 |
| E6-T5 | Add runtime resilience benchmark harness for fallback latency, remote jitter, and BFF degradation | QA Infra + Runtime Federation | 3d | Sequential after E6-T1 | E6-T1 |
| E6-T6 | Add selective worker-lane pilot for high-frequency transforms with guarded fallback-to-main-thread behavior | Runtime Federation | 3d | Sequential after E6-T5 | E6-T5 |

## EPIC-7: MCP Capability Parity via CLI (ADR-0009)

| Task ID | Task | Suggested Owner | Estimate | Parallelization | Depends On |
| --- | --- | --- | --- | --- | --- |
| E7-T1 | Build a canonical capability registry (`id`, input schema, output schema, side-effects, auth model) used by MCP and CLI | AI Platform | 2d | Parallel | None |
| E7-T2 | Introduce CLI parity command surface and JSON output contract for every MCP capability | Platform Build + AI Platform | 2d | Sequential after E7-T1 | E7-T1 |
| E7-T3 | Add MCPorter bridge adapter for rapid parity bootstrap of low-risk read-only capabilities | AI Platform | 1d | Parallel with E7-T2 | E7-T1 |
| E7-T4 | Add parity conformance tests (schema parity, exit-code parity, error-shape parity) | QA Infra | 2d | Sequential after E7-T2 | E7-T2 |
| E7-T5 | Add capability parity report artifact and release gate check | Observability Platform + QA Infra | 1d | Sequential after E7-T4 | E7-T4 |

## Suggested Sprint Packaging

1. Sprint 1 (parallel heavy):
   - EPIC-1 full.
   - EPIC-2 tasks E2-T1..E2-T6.
   - EPIC-3 tasks E3-T1..E3-T2.
2. Sprint 2:
   - EPIC-2 E2-T7.
   - EPIC-3 E3-T3..E3-T7.
   - EPIC-4 E4-T1..E4-T4.
3. Sprint 3:
   - EPIC-4 E4-T5..E4-T7.
   - EPIC-5 E5-T1..E5-T2 design completion.
4. Sprint 4+:
   - EPIC-5 E5-T3..E5-T7.
5. Sprint 5:
   - EPIC-6 E6-T1..E6-T4.
   - EPIC-7 E7-T1..E7-T3.
6. Sprint 6:
   - EPIC-6 E6-T5..E6-T6.
   - EPIC-7 E7-T4..E7-T5.

## Definition of Done (global)

- ADR acceptance criteria are met for each epic.
- CI green with new tests enabled.
- No untyped runtime contract path introduced for Effect-only streams.
- Rollout notes and migration docs are published.
- MCP capability parity report is generated and attached for release candidate checks.
