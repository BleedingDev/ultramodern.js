---
name: ultramodern-bff-telemetry
description: Targeted guidance for UltraModern.js BFF producer requestId isolation, header propagation, telemetry startup/exporters, and queue reliability controls. Use when touching create-request, server telemetry config, telemetry plugins, or related tests.
---

# UltraModern BFF and Telemetry

## BFF Producer Contracts

- Source files:
  - `packages/server/create-request/src/node.ts`
  - `packages/server/create-request/src/browser.ts`
  - `packages/server/create-request/tests/node.test.ts`
  - `packages/server/create-request/tests/browser.test.ts`
- Non-default producer calls require `requestId`-scoped `configure(...)`.
- Missing setup throws `ProducerClientNotInitializedError`.
- Missing domain setup for non-default producer throws `ProducerDomainNotConfiguredError`.
- Runtime state is isolated by `requestId` maps (`realRequest`, `domainMap`, and related maps).

## Header and Trace Path

- Operation headers:
  - `x-operation-id`
  - `x-modernjs-bff-operation-context`
- Distributed tracing header:
  - `traceparent`
- Parse and preserve trace context (`traceId`, `spanId`) where available.
- Keep default-producer header forwarding behavior intact for Node SSR path.

## Telemetry Contracts

- Config type source: `packages/server/core/src/types/config/server.ts`
- Runtime/plugin implementation:
  - `packages/server/core/src/plugins/telemetry.ts`
  - `packages/server/prod-server/src/server/index.ts`
- Exporters:
  - `exporters.otlp.enabled`
  - `exporters.victoriaMetrics.enabled`
- Queue/backpressure knobs:
  - `maxQueueSize`
  - `maxBatchSize`
  - `flushIntervalMs`
- Reliability language:
  - startup probes are fail-fast when configured
  - enqueue/alert paths should remain best-effort and non-fatal
  - monitor dropped queue signal (`telemetry.queue.dropped`)

## Fast Validation

1. Run focused tests first:
   - `proto run pnpm -- test:ut -- packages/server/create-request`
   - `proto run pnpm -- test:ut -- packages/server/prod-server`
   - `proto run pnpm -- test:ut -- packages/server/core`
2. Validate no contract header regressions in tests touching operation context.
3. Confirm queue and exporter behavior remains backward-compatible for existing apps.
