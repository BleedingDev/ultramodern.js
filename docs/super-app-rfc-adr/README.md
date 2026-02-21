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

| Workstream | ADR | Parallelization | Depends On | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| RsDoctor default-on in normal builds | ADR-0001 | Parallel | None | Implemented | Default-on in production build with opt-out and non-blocking defaults |
| Cross-project BFF hardening | ADR-0005 | Parallel | None | Implemented | Prefix/runtime fail-fast checks and safer generated runtime contracts |
| Telemetry standardization + exporters (incl. VictoriaMetrics) | ADR-0004 | Parallel | None | Implemented | Canonical envelope, registry, OTLP + VictoriaMetrics exporters |
| Effect-only MF data-fetch reliability + tests | ADR-0003 | Parallel with ADR-0001/0004, partially sequential with ADR-0005 | ADR-0005 (for some bootstrap and contract assumptions) | Implemented | Deterministic failure-injection and typed reliability tests in dev/serve |
| App-level MF SSR strategy + implementation | ADR-0002 | Mostly sequential | ADR-0005 and ADR-0003 | Implemented (Alpha) | Feature-flagged alpha path with integration and fallback coverage |

## Suggested Phases

1. Phase A (Parallel): Completed.
2. Phase B (Mixed): Completed.
3. Phase C (Sequential): In progress; alpha milestones delivered.
