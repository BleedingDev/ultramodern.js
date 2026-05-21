---
name: Ultramodern Readiness 04 Observability OTel Fallback
overview: Route generated SuperApp operational signals through the existing logging and OpenTelemetry layer so remote loading, fallback rendering, Effect service calls, schema failures, and degraded states are visible without creating a separate telemetry system.
todos:
  - id: audit-existing-otel-logging
    content: Audit current generated telemetry exporters, logging utilities, Effect OTel dependencies, and fallback signal placeholders.
    status: pending
  - id: define-default-events
    content: Define a small domain-neutral event set for remote loaded, remote failed, fallback rendered, service request started, service failed, schema decode failed, and degraded mode entered.
    status: pending
  - id: map-events-to-otel
    content: Map generated events to logs, spans, span attributes, and metrics using existing OTel/logging infrastructure instead of a custom telemetry backend.
    status: pending
  - id: wire-generated-examples
    content: Plan generated shell, remote, and Effect service examples that emit the default operational signals through the shared layer.
    status: pending
  - id: test-observability-output
    content: Plan tests or smoke checks that assert fallback and Effect service failures produce observable records with operation context.
    status: pending
isProject: true
---

# Ultramodern Readiness 04 Observability OTel Fallback

## Execution Notes

This work is useful only if it feeds the normal error, logging, and OTel layer. UltraModern should not create a second telemetry island. The generated workspace should make production-relevant events visible by default while allowing apps to swap exporters.

## Constraints

- Do not add a framework-owned SaaS dashboard.
- Do not add ERP-specific event names.
- Do not duplicate OTel concepts with custom abstractions.
- Keep generated signals small and actionable.

## Operator Guidance

Use OTel/logging as the sink. The generated events should answer which remote or service failed, which operation saw the failure, whether fallback rendered, and whether the user path was blocked or degraded.
