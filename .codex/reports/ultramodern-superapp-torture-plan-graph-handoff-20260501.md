# UltraModern SuperApp Torture Plan Graph Handoff

Date: 2026-05-01
Branch: `main-ultramodern`

## Purpose

This handoff captures the exact graph selection for the next SuperApp torture
validation wave. Reuse this bundle when handing the work to `plan-graph`,
`subagent-graph`, `dag`, or `helm`.

## Canonical Graph State

- `graph_id`: `ultramodern-superapp-torture-v1`
- `selection_hash`: `83efa5ca56`
- `plan_count`: 8
- `edge_count`: 13
- `snapshot_path`: `.codex/plan-graphs/ultramodern-superapp-torture-v1/snapshot.json`
- `state_dir`: `.codex/plan-graphs/ultramodern-superapp-torture-v1`

## Plan Selection

Use this exact selection:

```bash
--plans-root ./.codex/plans \
--glob 'ultramodern-superapp-torture-*.plan.md'
```

Selected plans:

- `.codex/plans/ultramodern-superapp-torture-harness-telemetry.plan.md`
- `.codex/plans/ultramodern-superapp-torture-workload-data.plan.md`
- `.codex/plans/ultramodern-superapp-torture-k6-load.plan.md`
- `.codex/plans/ultramodern-superapp-torture-chaos-failure.plan.md`
- `.codex/plans/ultramodern-superapp-torture-effect-tanstack-contracts.plan.md`
- `.codex/plans/ultramodern-superapp-torture-browser-runtime.plan.md`
- `.codex/plans/ultramodern-superapp-torture-soak-stability.plan.md`
- `.codex/plans/ultramodern-superapp-torture-destroy-readiness.plan.md`

## Dependency Edges

Use these exact edges:

```bash
--depends ultramodern-superapp-torture-harness-telemetry:ultramodern-superapp-torture-k6-load \
--depends ultramodern-superapp-torture-workload-data:ultramodern-superapp-torture-k6-load \
--depends ultramodern-superapp-torture-harness-telemetry:ultramodern-superapp-torture-chaos-failure \
--depends ultramodern-superapp-torture-workload-data:ultramodern-superapp-torture-chaos-failure \
--depends ultramodern-superapp-torture-harness-telemetry:ultramodern-superapp-torture-effect-tanstack-contracts \
--depends ultramodern-superapp-torture-workload-data:ultramodern-superapp-torture-effect-tanstack-contracts \
--depends ultramodern-superapp-torture-harness-telemetry:ultramodern-superapp-torture-browser-runtime \
--depends ultramodern-superapp-torture-workload-data:ultramodern-superapp-torture-browser-runtime \
--depends ultramodern-superapp-torture-k6-load:ultramodern-superapp-torture-soak-stability \
--depends ultramodern-superapp-torture-chaos-failure:ultramodern-superapp-torture-soak-stability \
--depends ultramodern-superapp-torture-effect-tanstack-contracts:ultramodern-superapp-torture-soak-stability \
--depends ultramodern-superapp-torture-browser-runtime:ultramodern-superapp-torture-soak-stability \
--depends ultramodern-superapp-torture-soak-stability:ultramodern-superapp-torture-destroy-readiness
```

## Frontier

Ready root lanes:

- `ultramodern-superapp-torture-harness-telemetry`
- `ultramodern-superapp-torture-workload-data`

Blocked after both roots:

- `ultramodern-superapp-torture-k6-load`
- `ultramodern-superapp-torture-chaos-failure`
- `ultramodern-superapp-torture-effect-tanstack-contracts`
- `ultramodern-superapp-torture-browser-runtime`

Terminal lanes:

- `ultramodern-superapp-torture-soak-stability`
- `ultramodern-superapp-torture-destroy-readiness`

## Validation Command

```bash
python /Users/satan/side/experiments/skills/plan-graph/scripts/plan_graph.py validate \
  --plans-root ./.codex/plans \
  --glob 'ultramodern-superapp-torture-*.plan.md' \
  --depends ultramodern-superapp-torture-harness-telemetry:ultramodern-superapp-torture-k6-load \
  --depends ultramodern-superapp-torture-workload-data:ultramodern-superapp-torture-k6-load \
  --depends ultramodern-superapp-torture-harness-telemetry:ultramodern-superapp-torture-chaos-failure \
  --depends ultramodern-superapp-torture-workload-data:ultramodern-superapp-torture-chaos-failure \
  --depends ultramodern-superapp-torture-harness-telemetry:ultramodern-superapp-torture-effect-tanstack-contracts \
  --depends ultramodern-superapp-torture-workload-data:ultramodern-superapp-torture-effect-tanstack-contracts \
  --depends ultramodern-superapp-torture-harness-telemetry:ultramodern-superapp-torture-browser-runtime \
  --depends ultramodern-superapp-torture-workload-data:ultramodern-superapp-torture-browser-runtime \
  --depends ultramodern-superapp-torture-k6-load:ultramodern-superapp-torture-soak-stability \
  --depends ultramodern-superapp-torture-chaos-failure:ultramodern-superapp-torture-soak-stability \
  --depends ultramodern-superapp-torture-effect-tanstack-contracts:ultramodern-superapp-torture-soak-stability \
  --depends ultramodern-superapp-torture-browser-runtime:ultramodern-superapp-torture-soak-stability \
  --depends ultramodern-superapp-torture-soak-stability:ultramodern-superapp-torture-destroy-readiness
```

## Notes

Do not run this graph using only `--graph-id`; always include the plan selection
and dependency edges above. The explicit selection is the durable contract.
