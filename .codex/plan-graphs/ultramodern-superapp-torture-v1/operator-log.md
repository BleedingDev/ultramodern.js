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
| workload-data | `019de297-0279-7e20-a4c2-da1edc76a5a8` (`Ampere`) | worker | completed for `ust-data-02` | Deterministic generated workload data landed in commit `02fc730bb2`; next todo `ust-data-03` is ready. |
| workload-data | `019de2a3-bb3f-7be2-9b23-2492b1f2dba1` (`Sartre`) | worker | completed for `ust-data-03` | Scenario/profile definitions landed in commit `e12c9cd8b7`; next todo `ust-data-04` is ready. |
| workload-data | `019de2b1-9f1a-72b0-ab88-d800fc56fe12` (`Leibniz`) | worker | completed for `ust-data-04` | Deterministic reset/seed metadata landed locally; verified with `tsc`, Biome, and focused portfolio Vitest. Next todo `ust-data-05` is ready. |
| workload-data | `019de2bc-f5f5-72d2-845c-494bf4340285` (`Kierkegaard`) | worker | completed for `ust-data-05` | Machine-readable dataset/scenario/reset integrity artifact landed in commit `8a39078b23`; verified locally with `tsc`, Biome, and focused portfolio Vitest. Workload-data root is complete. |
| k6-load | `019de2c7-808b-7a52-b73f-01c1b4681fbf` (`Descartes`) | worker | in_progress | Owns `ust-load-01`: dependency-free k6 execution/fallback path under `scripts/superapp-k6` or minimal `scripts/superapp-load` reuse plus k6-load plan status only. |
| chaos-failure | `019de2c7-812e-70f1-ab13-a88c78dd4471` (`Raman`) | worker | in_progress | Owns `ust-chaos-01`: deterministic failure taxonomy under `tests/integration/superapp-portfolio/shared` plus focused tests and chaos plan status only. |
| effect-tanstack-contracts | `019de2c7-81b1-7022-9904-51b3ef1b03a5` (`Helmholtz`) | worker | in_progress | Owns `ust-contract-01`: machine-readable Effect/TanStack contract map under SuperApp portfolio shared/tests plus contract plan status only. |
| browser-runtime | `019de2c7-8237-72a2-9807-480737958d59` (`Zeno`) | worker | in_progress | Owns `ust-browser-01`: focused browser coverage under SuperApp portfolio tests plus browser plan status only. |
