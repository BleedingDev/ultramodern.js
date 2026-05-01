# UltraModern SuperApp Torture Operator Log

Graph: `ultramodern-superapp-torture-v1`
Selection hash: `83efa5ca56`
Issue: `modernjs-xuy`

## Launch Waves

Wave 1:

- `ultramodern-superapp-torture-harness-telemetry`: local primary agent. Write scope: `.codex/plan-graphs/ultramodern-superapp-torture-v1/operator-log.md`, `.codex/reports/*superapp*torture*`, reusable `scripts/superapp-*` harness surfaces, and plan status updates. Do not edit `tests/integration/superapp-portfolio` fixture data except to read existing behavior.
- `ultramodern-superapp-torture-workload-data`: worker lane. Write scope: `tests/integration/superapp-portfolio` deterministic data and scenario catalog only. Do not edit shared certification scripts, shared load runner scripts, lockfiles, or plan graph snapshots.

Wave 2, after both Wave 1 roots complete:

- `ultramodern-superapp-torture-k6-load`: owner of k6/autocannon runners and load certification profiles.
- `ultramodern-superapp-torture-chaos-failure`: owner of deterministic failure injection and chaos matrix.
- `ultramodern-superapp-torture-effect-tanstack-contracts`: owner of Effect BFF and TanStack contract tests.
- `ultramodern-superapp-torture-browser-runtime`: owner of Playwright and runtime/build matrix.

Wave 3:

- `ultramodern-superapp-torture-soak-stability`: consumes Wave 2 artifacts and adds long-duration drift detection.
- `ultramodern-superapp-torture-destroy-readiness`: terminal destroy-run aggregation and go/no-go report.

## Conflict Hotspots

- `scripts/superapp-certification/run-superapp-certification.js`: local owner only until Wave 2.
- `scripts/superapp-load/run-superapp-load.js`: local owner only until Wave 2.
- `.codex/plan-graphs/ultramodern-superapp-torture-v1/snapshot.json`: local owner only; regenerate via `plan_graph.py` with explicit selection and dependencies.
- `.codex/plans/ultramodern-superapp-torture-*.plan.md`: local owner for status changes.
- `tests/integration/superapp-portfolio`: worker owner for workload-data lane; local agent reads only during Wave 1.
- `pnpm-lock.yaml`: no manual edits.

## Live Lanes

| Lane | Agent | Owner | Status | Next Action |
| --- | --- | --- | --- | --- |
| harness-telemetry | primary | local | completed | `ust-harness-01..05` complete; release/nightly harness contract artifact is wired without changing smoke profile cost. |
| workload-data | `019de282-19b0-7643-951f-97bcaa57110e` (`Banach`) | worker | completed for `ust-data-01` | Domain catalog landed in `tests/integration/superapp-portfolio`; next todo `ust-data-02` remains pending. |
