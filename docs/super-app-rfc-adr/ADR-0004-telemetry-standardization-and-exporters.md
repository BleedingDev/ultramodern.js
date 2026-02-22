# ADR-0004: Telemetry Standardization and Multi-Exporter Support

- Status: Implemented
- Date: 2026-02-21
- Decision Type: Observability architecture

## 1. Context

Modern.js already exposes monitor events and trace-aware runtime paths. To support super-app scale, telemetry must be standardized and exportable to multiple backends with minimal app-level boilerplate.

## 2. Decision

Introduce a framework telemetry standardization layer with pluggable exporters.

- Define a canonical telemetry envelope.
- Provide exporter interface and lifecycle hooks.
- Ship first-party exporters:
  - OTLP exporter
  - VictoriaMetrics exporter

## 3. Canonical Envelope (minimum fields)

- `timestamp`
- `service`
- `module`
- `environment`
- `signalType` (`log` | `metric` | `trace`)
- `name`
- `level` (for logs)
- `value` and `unit` (for metrics)
- `traceId`, `spanId`, `parentSpanId` (when present)
- `tags`
- `attributes`
- `error` payload (when present)

## 4. Exporter Model

- `init(config)`
- `emit(batch)`
- `flush()`
- `shutdown()`
- Required behavior:
  - async batching
  - bounded memory
  - backpressure strategy
  - sampling support
  - redaction hooks

## 5. VictoriaMetrics Requirements

- Native framework exporter package for VictoriaMetrics integration.
- Configurable transport mode to match deployment constraints.
- Clear mapping of framework metrics to VictoriaMetrics naming conventions.
- Interoperability with trace correlation fields.

## 6. Implementation Plan

1. Introduce telemetry envelope types and runtime adapters.
2. Implement exporter interface and registry.
3. Implement OTLP exporter.
4. Implement VictoriaMetrics exporter.
5. Add integration tests with mock exporters and backpressure simulation.
6. Add docs for configuration, redaction, and performance tuning.

## 7. Parallelization

- Execution mode: Parallel.
- Depends on: None.
- Blocks:
  - none strictly, but strongly recommended before full ADR-0002 rollout.

## 8. Acceptance Criteria

- Framework can emit standardized events with no app code changes.
- Multiple exporters can run together or independently.
- VictoriaMetrics exporter passes integration tests.
- Telemetry overhead remains within agreed budget in perf tests.

## 9. Implementation Notes (2026-02-21)

- Canonical telemetry envelope, batching queue, redaction, and exporter registry are implemented in server core.
- First-party exporters are implemented and tested:
  - OTLP exporter.
  - VictoriaMetrics exporter.
- Framework config surface is available under `server.telemetry` with exporter-specific options.
- Exporter health model is tracked per exporter (`healthy`, failure count, last error/success timestamps).
- Startup probe runs during server initialization and defaults to fail-loud mode; opt-out is available via `server.telemetry.failLoudStartup = false`.
- Queue visibility is exported as first-party telemetry metrics:
  - `telemetry.queue.depth`
  - `telemetry.queue.utilization`
  - `telemetry.queue.dropped`
- SLO alert thresholds are configurable via `server.telemetry.slo` and are wired to runtime warning hooks for early degradation detection.
- Validation coverage:
  - `packages/server/prod-server/tests/telemetry.test.ts`
  - `pnpm --filter @modern-js/prod-server test -- --runInBand`

## 10. Canary Rollout and Rollback Notes (2026-02-22)

- Added `TelemetryCanaryOrchestrator` for release orchestration with promotion/rollback decisions.
- Promotion criteria are tied to telemetry and contract gates:
  - queue utilization threshold
  - dropped-envelope budget
  - unhealthy exporter budget
  - required contract gate pass set
- Automated rollback triggers when consecutive failing evaluations exceed configured threshold.
- Config surface added under `server.telemetry.canary`:
  - `enabled`
  - `evaluationIntervalMs`
  - `minConsecutiveHealthyEvaluations`
  - `rollbackConsecutiveFailures`
  - `maxQueueUtilization`
  - `maxTotalDropped`
  - `maxUnhealthyExporters`
  - `contractGates`
- Runtime wiring:
  - server init starts orchestrator when enabled
  - promotion/rollback events are logged
  - canary decision metrics emitted:
    - `telemetry.canary.promote`
    - `telemetry.canary.rollback`
- Validation coverage:
  - `packages/server/prod-server/tests/telemetry.test.ts`
  - `pnpm --filter @modern-js/prod-server test -- --runInBand`

## 11. Release-Candidate Contract Gate Pipeline Notes (2026-02-22)

- Added release-candidate contract gate workflow:
  - `.github/workflows/release-contract-gates.yml`
- Added gate validator tooling:
  - `scripts/release-gates/validate-release-candidate-gates.js`
  - `scripts/release-gates/validator.js`
  - `scripts/release-gates/rc-contract-profile.json`
- Pipeline enforces:
  - A-D gate evidence file presence and metadata shape
  - minimum review evidence cardinality (>=2 reviewer entries)
  - migration contract assertions on representative module artifacts
  - representative lane command execution for release-candidate validation
- Validation coverage:
  - `scripts/release-gates/__tests__/validator.test.js`
  - `node --test scripts/release-gates/__tests__/validator.test.js`
