# UltraModern.js SuperApp Load Boundary Report

Date: 2026-05-01
Branch: `main-ultramodern`

## Scope

This report captures the HTTP load boundary pass for the SuperApp portfolio
pilot after production scenarios were added. The target app was the production
served `tests/integration/superapp-portfolio` fixture, covering:

- portfolio bootstrap reads
- cross-app workflow writes
- production pilot scenarios
- pilot chaos scenarios
- invalid payload and tenant-boundary probes
- reset cycles

## Tooling

- Added `portfolio` support to `scripts/superapp-load/run-superapp-load.js`.
- Added opt-in Vitest load certification:
  `tests/integration/superapp-portfolio/tests/load.test.ts`.
- Added release gate: `superapp-portfolio-load`.
- Added nightly boundary gate: `superapp-portfolio-load-boundary`.
- Ran real `autocannon` through `pnpm dlx autocannon` without adding a
  dependency or editing lockfiles.
- `k6` was not available in this checkout because the local `k6` shim points to
  an unconfigured proto plugin.

## Stable Load Results

`superapp-portfolio-load-boundary`

- Artifact:
  `/tmp/modernjs-superapp-load-nightly/artifacts/portfolio-load-boundary/summary.json`
- Duration: 30s
- Concurrency: 384
- Requests: 234,602
- p95: 66 ms
- p99: 96 ms
- max: 7,189 ms
- unexpected errors: 0
- budget failures: 0

Manual boundary probes:

- c=48, 12s: 101,507 requests, p95 9 ms, max 233 ms, 0 errors.
- c=96, 30s: 254,084 requests, p95 16 ms, max 537 ms, 0 errors.
- c=192, 30s: 223,110 requests, p95 48 ms, max 1,702 ms, 0 errors.
- c=384, 30s: 232,567 requests, p95 68 ms, max 8,297 ms, 0 errors.
- c=448, 30s: 230,140 requests, p95 79 ms, max 10,848 ms, 0 errors.

Observed boundary:

- c=480, 30s: 200,664 requests, p95 125 ms, max 13,179 ms, 62 fetch failures.
- c=512, 30s: 221,818 requests, p95 89 ms, max 13,122 ms, 51 fetch failures.
- c=768, 20s: 136,513 requests, p95 120 ms, max 13,598 ms, 513 fetch failures.

The failures were client-side `fetch failed; cause=AggregateError` around the
8.3s mark, not HTTP 4xx/5xx application responses.

## Autocannon Results

POST pilot endpoint:

- Command class: `pnpm dlx autocannon`, POST
  `/bff-api/effect/pilot/grab-marketplace/run`
- Concurrency: 256
- Duration: 20s
- Requests: 166,055
- Average req/s: 8,303
- p99 latency: 49 ms
- max latency: 3,714 ms
- errors: 0
- timeouts: 0
- non-2xx: 0

GET bootstrap endpoint:

- Command class: `pnpm dlx autocannon`, GET `/bff-api/effect/bootstrap`
- Concurrency: 512
- Duration: 20s
- Requests: 153,156
- Average req/s: 7,659
- p99 latency: 125 ms
- max latency: 14,603 ms
- errors: 84
- timeouts: 58
- non-2xx: 0

## Fixes Made

- Fixed load runner duration aggregation so large sample sets no longer crash
  on `Math.min(...values)` / `Math.max(...values)`.
- Added richer fetch error details including `error.cause`.
- Promoted portfolio pilot load to certification so future regressions are
  caught by release/nightly profiles.

## Readiness Result

Final nightly certification:

- Artifact: `/tmp/modernjs-superapp-load-nightly/summary.json`
- Commands: 17
- Failed commands: 0
- Upstream drift: merged, no conflicts

Final readiness report:

- Artifact: `/tmp/modernjs-superapp-load-readiness/readiness.md`
- Overall status: `ready`
- Load evidence is included in stress and performance readiness dimensions.
