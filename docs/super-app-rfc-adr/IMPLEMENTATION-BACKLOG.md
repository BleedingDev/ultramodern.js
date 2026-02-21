# Super App Implementation Backlog

- Status: Active (release-v4 subset backport in progress)
- Date: 2026-02-21
- Source docs:
  - `RFC-0001-super-app-foundation-plan.md`
  - `ADR-0001-rsdoctor-default-on.md`
  - `ADR-0002-app-level-mf-ssr-strategy.md`
  - `ADR-0003-effect-only-mf-data-fetch-reliability.md`
  - `ADR-0004-telemetry-standardization-and-exporters.md`
  - `ADR-0005-cross-project-bff-hardening.md`

## Owner Legend

- Platform Build: framework build and bundler integration.
- Runtime Federation: module federation runtime and SSR composition.
- BFF Platform: cross-project BFF generation/runtime.
- Observability Platform: monitors, telemetry, exporters.
- QA Infra: integration tests, fixtures, CI workflows.

## Epic Overview

| Epic ID | Epic | ADR | Suggested Owner | Effort | Parallelization | Depends On | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| EPIC-1 | RsDoctor Default-On | ADR-0001 | Platform Build | M | Parallel | None | Implemented |
| EPIC-2 | Cross-Project BFF Hardening | ADR-0005 | BFF Platform | L | Parallel | None | Implemented (Release-v4 subset) |
| EPIC-3 | Telemetry Standardization + Exporters | ADR-0004 | Observability Platform | L | Parallel | None | Implemented (Release-v4 adapted) |
| EPIC-4 | Effect-Only MF Data-Fetch Reliability | ADR-0003 | Runtime Federation + QA Infra | L | Parallel-start, partial sequential | EPIC-2 (partial) | Deferred on release-v4 |
| EPIC-5 | App-Level MF SSR | ADR-0002 | Runtime Federation | XL | Mostly sequential | EPIC-2, EPIC-4 | Partial on release-v4 (contracts + docs/tests) |

## Progress Snapshot (2026-02-21)

- EPIC-1 complete on release-v4: RsDoctor defaults are enabled in production with opt-out and non-blocking plugin defaults.
- EPIC-2 complete on release-v4 subset: cross-project BFF request contracts are hardened with request-id aware bootstrap/runtime.
- EPIC-3 complete on release-v4 adaptation: telemetry envelope/registry plus OTLP and VictoriaMetrics exporters are integrated in `prod-server`.
- EPIC-4 deferred on release-v4: direct fixture backport fails against release-v4 contracts (`@tanstack/react-router` and `@module-federation/modern-js-v3/runtime` are unavailable and `Response.json` static helper assumptions mismatch release-v4 runtime/types).
- EPIC-5 partial on release-v4: alpha config/env contracts backported with runtime unit coverage and SSR config docs; full app-level MF SSR runtime integration deferred.

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

## Definition of Done (global)

- ADR acceptance criteria are met for each epic.
- CI green with new tests enabled.
- No untyped runtime contract path introduced for Effect-only streams.
- Rollout notes and migration docs are published.
