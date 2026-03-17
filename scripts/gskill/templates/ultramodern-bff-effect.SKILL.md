---
name: ultramodern-bff-effect
description: Codex guidance for BFF development with Effect, trace integrity, and requestId-scoped contracts in UltraModern.js.
---

# UltraModern BFF with Effect (Codex)

## Effect API Anchors

- `tests/integration/routes-tanstack-mf/mf-host/shared/effect/api.ts`
- `tests/integration/routes-tanstack-mf/mf-host/api/effect/index.ts`
- `tests/integration/routes-tanstack-mf/mf-remote/shared/effect/api.ts`
- `Schema.optional(Schema.String)`

## Trace and Header Integrity

- `traceparent`
- `parseTraceparent`
- `traceId`
- `spanId`
- `x-operation-id`
- `x-modernjs-bff-operation-context`

## Request Lifecycle Contracts

- Keep BFF calls requestId-scoped.
- Fail fast for missing producer configuration.
- Preserve header propagation from browser -> BFF -> Effect spans.

## Fast Checks

- `proto run pnpm -- test:ut -- packages/server/create-request`
- `proto run pnpm -- test:framework -- integration/bff-effect/tests/index.test.ts --runInBand`
