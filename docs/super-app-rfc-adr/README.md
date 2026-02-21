# Super App RFC / ADR Set

This folder contains planning artifacts for building a super-app-ready Modern.js platform with independently deployable modules, strong observability, and type-safe cross-project integration.

## Documents

- `RFC-0001-super-app-foundation-plan.md`
- `ADR-0001-rsdoctor-default-on.md`
- `ADR-0002-app-level-mf-ssr-strategy.md`
- `ADR-0003-effect-only-mf-data-fetch-reliability.md`
- `ADR-0004-telemetry-standardization-and-exporters.md`
- `ADR-0005-cross-project-bff-hardening.md`
- `IMPLEMENTATION-BACKLOG.md`
- `RELEASE-V4-BACKPORT-PLAN.md`

## Execution Matrix

| Workstream | ADR | Parallelization | Depends On | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| RsDoctor default-on in normal builds | ADR-0001 | Parallel | None | Implemented | Default-on in production build with opt-out and non-blocking defaults |
| Cross-project BFF hardening | ADR-0005 | Parallel | None | Implemented (Release-v4 subset) | Request-id scoped bootstrap/runtime fail-fast contracts are backported |
| Telemetry standardization + exporters (incl. VictoriaMetrics) | ADR-0004 | Parallel | None | Implemented (Release-v4 adapted) | Canonical envelope + queue + OTLP/VictoriaMetrics exporters in `prod-server` |
| Effect-only MF data-fetch reliability + tests | ADR-0003 | Parallel with ADR-0001/0004, partially sequential with ADR-0005 | ADR-0005 (for some bootstrap and contract assumptions) | Deferred on release-v4 | `routes-tanstack-mf` integration fixture/runtime path is not available on release-v4 |
| App-level MF SSR strategy + implementation | ADR-0002 | Mostly sequential | ADR-0005 and ADR-0003 | Partial (contracts only) | `moduleFederationAppSSRAlpha` config + env contract backported; full runtime path deferred |

## Suggested Phases

1. Phase A (Parallel): Completed on release-v4 backport branch.
2. Phase B (Mixed): Completed for feasible release-v4 subsets.
3. Phase C (Sequential): Pending for deferred streams that require runtime architecture not present in release-v4.
