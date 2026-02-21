# ADR-0004: Telemetry Standardization and Multi-Exporter Support

- Status: Proposed
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
