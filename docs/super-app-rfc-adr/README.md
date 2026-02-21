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

## Execution Matrix

| Workstream | ADR | Parallelization | Depends On | Notes |
| --- | --- | --- | --- | --- |
| RsDoctor default-on in normal builds | ADR-0001 | Parallel | None | Can start immediately |
| Cross-project BFF hardening | ADR-0005 | Parallel | None | Start early, used by other streams |
| Telemetry standardization + exporters (incl. VictoriaMetrics) | ADR-0004 | Parallel | None | Start early to establish shared telemetry contract |
| Effect-only MF data-fetch reliability + tests | ADR-0003 | Parallel with ADR-0001/0004, partially sequential with ADR-0005 | ADR-0005 (for some bootstrap and contract assumptions) | Test harness can start now |
| App-level MF SSR strategy + implementation | ADR-0002 | Mostly sequential | ADR-0005 and ADR-0003 | Can run design in parallel, implementation should come later |

## Suggested Phases

1. Phase A (Parallel): ADR-0001, ADR-0004, ADR-0005.
2. Phase B (Mixed): ADR-0003 begins; integrate with ADR-0005 outputs.
3. Phase C (Sequential): ADR-0002 implementation after ADR-0003 and ADR-0005 stabilize.
