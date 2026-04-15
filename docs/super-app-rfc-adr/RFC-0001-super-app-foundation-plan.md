# RFC-0001: Super App Foundation Plan

- Status: Implemented (Phases A/B/C complete)
- Date: 2026-02-21
- Scope: Modern.js framework-level capability roadmap

## 1. Summary

This RFC defines a framework roadmap to make Modern.js super-app-ready while preserving independent deployability of modules and high developer velocity. It formalizes five features as ADRs and defines execution order, dependency constraints, and acceptance gates.

## 2. Goals

- Enable large multi-module products (ERP and beyond) without monolith coupling.
- Keep per-module deployability and isolated failure domains.
- Make cross-project APIs type-safe and less error-prone.
- Standardize telemetry and exporter integration, including VictoriaMetrics.
- Improve reliability of Module Federation data-fetch and error handling.
- Promote app-level MF SSR to a stable default contract for server-rendered MF apps.

## 3. Non-Goals

- Domain-specific business workflows.
- Organization-specific release governance process.
- Vendor-locked monitoring backends in framework core.

## 4. Workstreams

1. RsDoctor default-on in normal build (ADR-0001).
2. App-level Module Federation SSR readiness (ADR-0002).
3. Effect-only MF data-fetch reliability and tests (ADR-0003).
4. Telemetry standardization and multi-exporter support, including VictoriaMetrics (ADR-0004).
5. Cross-project BFF hardening and safer bootstrap/runtime contracts (ADR-0005).

## 5. Parallel vs Sequential Plan

| Workstream | Execution | Why |
| --- | --- | --- |
| ADR-0001 | Parallel | Self-contained diagnostics behavior |
| ADR-0005 | Parallel, start early | Provides safer cross-project contracts used by other streams |
| ADR-0004 | Parallel, start early | Defines telemetry contract shared across streams |
| ADR-0003 | Parallel-start, then partial-sequential | Test harness can start now, some integration assumes ADR-0005 outputs |
| ADR-0002 | Mostly sequential | App-level MF SSR depends on stabilized contracts and reliability baseline |

## 6. Phase Plan

### Phase A: Foundation (parallel)

- Execute ADR-0001, ADR-0004, ADR-0005.
- Exit criteria:
  - RsDoctor enabled by default with documented opt-out.
  - Telemetry envelope and exporter interface merged.
  - BFF cross-project runtime/bootstrap guardrails merged.

### Phase B: Reliability (mixed)

- Execute ADR-0003.
- Exit criteria:
  - Dedicated MF data-fetch fixture and failure-injection tests merged.
  - Effect-only schema and runtime paths validated in CI.

### Phase C: SSR Expansion (sequential, completed)

- Execute ADR-0002 implementation milestones.
- Exit criteria:
  - App-level MF SSR stable contract path enabled for server-rendered MF markers.
  - Hydration and fallback behavior stable under serve-mode integration tests.

## 7. Risks and Mitigations

- Build-time overhead from always-on diagnostics.
  - Mitigation: strict output control, artifact retention policy, caching guidance, opt-out switch.
- Added framework complexity from new contracts.
  - Mitigation: phased rollout, feature flags, compatibility checks at compile/startup.
- Telemetry overhead and privacy leakage.
  - Mitigation: async batching, sampling, redaction defaults, explicit PII policy.

## 8. Deliverables

- RFC + ADR set in this folder.
- Implementation tracking backlog per ADR (`IMPLEMENTATION-BACKLOG.md`).
- CI matrix updates for diagnostics and integration gates.

## 9. Implementation Snapshot (2026-02-21)

- Phase A complete:
  - RsDoctor is enabled by default in production builds with explicit opt-out and non-blocking defaults.
  - Cross-project BFF hardening landed (prefix/runtime validation, safer runtime bootstrap contract, deterministic package metadata merge with collision checks).
  - Server telemetry standardization landed with OTLP and VictoriaMetrics exporters.
- Phase B complete:
  - Effect-only MF data-fetch reliability coverage landed with deterministic failure injection and typed fallback contracts.
  - Distributed trace continuity checks are active in routes MF integration (build and serve modes).
- Phase C complete:
  - App-level MF SSR stable contract/env path and integration coverage landed, including serve-mode fallback behavior.
