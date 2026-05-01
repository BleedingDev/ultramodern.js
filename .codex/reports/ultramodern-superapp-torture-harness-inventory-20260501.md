# UltraModern SuperApp Torture Harness Inventory

Date: 2026-05-01
Graph: `ultramodern-superapp-torture-v1`
Plan lane: `ultramodern-superapp-torture-harness-telemetry`
Active todo: `ust-harness-01`

## Current Entry Points

Certification runner:

- Script: `scripts/superapp-certification/run-superapp-certification.js`
- Profiles: `smoke`, `release`, `nightly`
- Output root: `SUPERAPP_CERTIFICATION_OUT_DIR` or `.modern/superapp-certification/<run-id>`
- Summary artifact: `<outDir>/summary.json`
- Existing portfolio gates:
  - `superapp-portfolio-smoke`
  - `superapp-portfolio-security`
  - `superapp-portfolio-stress`
  - `superapp-pilot-chaos`
  - `superapp-portfolio-load`
  - `superapp-portfolio-nightly`
  - `superapp-portfolio-load-boundary`

Readiness report generator:

- Script: `scripts/superapp-certification/generate-readiness-report.js`
- Inputs: recursively discovered `summary.json` files plus explicit `--summary`
- Outputs:
  - `<outDir>/summary.json`
  - `<outDir>/readiness.md`
- Dimensions:
  - `contract`
  - `integration`
  - `stress`
  - `soak`
  - `browser`
  - `module-federation`
  - `security`
  - `performance`
  - `upstream-drift`

HTTP load runner:

- Script: `scripts/superapp-load/run-superapp-load.js`
- Targets: `erp`, `portfolio`
- Portfolio scenarios:
  - `bootstrap`
  - `workflow`
  - `pilot`
  - `chaos`
  - `invalid`
  - `reset`
  - `mixed`
- Output root: `SUPERAPP_LOAD_OUTPUT_DIR`, `SUPERAPP_LOAD_OUT`, or `.modern/superapp-load/<run-id>`
- Summary artifact: `<outputDir>/summary.json`

Portfolio fixture:

- App root: `tests/integration/superapp-portfolio`
- Main BFF API: `tests/integration/superapp-portfolio/api/effect/index.ts`
- Shared contracts/state:
  - `tests/integration/superapp-portfolio/shared/portfolio-api.ts`
  - `tests/integration/superapp-portfolio/shared/portfolio-state.ts`
- Existing local metrics helper: `tests/integration/superapp-portfolio/tests/portfolioMetrics.ts`
- Existing test lanes:
  - `tests/integration/superapp-portfolio/tests/index.test.ts`
  - `tests/integration/superapp-portfolio/tests/security.test.ts`
  - `tests/integration/superapp-portfolio/tests/stress.test.ts`
  - `tests/integration/superapp-portfolio/tests/nightly.test.ts`
  - `tests/integration/superapp-portfolio/tests/pilot-chaos.test.ts`
  - `tests/integration/superapp-portfolio/tests/load.test.ts`

## Current Artifact Shapes

Certification summary:

- `schemaVersion`
- `suite: "superapp-certification"`
- `generatedAt`
- `profile`
- `dryRun`
- `driftOnly`
- `commandCount`
- `failedCommandCount`
- `commands[]`
- `upstreamDrift`

Portfolio load summary:

- `schemaVersion`
- `suite: "superapp-portfolio-load"`
- `runId`
- `target`
- `scenario`
- `baseUrl`
- `startedAt`
- `finishedAt`
- `durationMs`
- `parameters`
- `budgets`
- `requestCount`
- `okCount`
- `unexpectedErrorCount`
- `unexpectedErrorRate`
- `durations`
- `operations`
- `eventLoopDelay`
- `cleanup`
- `unexpectedErrors[]`
- `budgetFailures[]`

Portfolio metrics summary:

- `schemaVersion`
- `suite`
- `startedAt`
- `finishedAt`
- `requestCount`
- `unexpectedErrorCount`
- `operations`
- `eventLoopDelay`
- suite-specific extra fields

Readiness summary:

- `suite: "superapp-readiness-report"`
- `generatedAt`
- `inputDir`
- `evidence[]`
- `readiness`

## Canonical Inputs For Later Lanes

All later lanes should consume these shared inputs instead of defining their own
parallel scenario language:

- Portfolio app ids from `shared/portfolio-state.ts`:
  - `mobility-marketplace`
  - `enterprise-mega-erp`
  - `mf-platform`
  - `tenant-security`
  - `failure-lab`
- Pilot scenarios:
  - `grab-marketplace`
  - `mega-erp-command-center`
  - `mobility-erp-chat`
- Pilot modules:
  - `rides`
  - `dispatch`
  - `orders`
  - `erp`
  - `chat`
  - `mf-remotes`
  - `security`
  - `billing`
- Chaos modes:
  - `none`
  - `remote-down`
  - `api-timeout`
  - `chunk-404`
  - `clock-skew`
  - `restart-during-load`
- Existing request endpoints:
  - `GET /bff-api/effect/bootstrap`
  - `POST /bff-api/effect/apps/:appId/workflow`
  - `POST /bff-api/effect/pilot/:scenario/run`
  - `POST /bff-api/effect/reset`

## Required Shared Harness Contract

The next harness todo should add reusable process-control and sampling pieces
without changing default PR cost:

- Production server controller:
  - build command
  - serve command
  - dynamic port
  - readiness probe
  - startup timeout
  - clean shutdown
  - stdout/stderr capture on failure
- Metrics sampler:
  - rss
  - heap used
  - heap total
  - external memory
  - event-loop delay p95/p99/max
  - request count by operation
  - classified error count by source
  - reset success
- Artifact envelope:
  - `schemaVersion`
  - `suite`
  - `target`
  - `profile`
  - `startedAt`
  - `finishedAt`
  - `durationMs`
  - `parameters`
  - `budgets`
  - `status`
  - `budgetFailures`
  - `observations`
  - `artifacts`

## Ownership Rules For Wave 1

Local primary agent owns:

- shared harness inventory and future server-controller design
- `.codex/plans/ultramodern-superapp-torture-*.plan.md` status changes
- `.codex/plan-graphs/ultramodern-superapp-torture-v1/snapshot.json`
- `.codex/plan-graphs/ultramodern-superapp-torture-v1/operator-log.md`
- `.codex/reports/*superapp*torture*`

Worker lane owns:

- `tests/integration/superapp-portfolio/**` workload-data definitions only

Shared files that must stay single-owner until Wave 2:

- `scripts/superapp-certification/run-superapp-certification.js`
- `scripts/superapp-load/run-superapp-load.js`
- `scripts/superapp-certification/generate-readiness-report.js`

## Immediate Follow-Up

After the workload-data worker returns, integrate its scenario catalog with this
inventory and then proceed to `ust-harness-02`: a reusable production server
controller that can decouple app serving from load generation.
