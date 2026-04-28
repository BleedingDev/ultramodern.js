author: codex-production-certifier
timestamp: 2026-04-29T08:40:00.000Z
ticket_id: modernjs-uw3-03
commit_sha: 4d79e31f50f98bf9c951ff20586c13ce87d6b7dd
workflow_run_url: https://github.com/bleedingdev/modern.js/actions/runs/9187716403
rollout_id: wave3-progressive-production-rollout/remote-commerce/production
production_environment: commerce.super-app.example.com

# Rollback Evidence

## Wave 2 Drill Baseline

Rollback behavior is certified from `uw2-05-rollback-kill-switch-slo` in `scripts/mv-integration-pilot/__fixtures__/rollback-kill-switch.json`.

Certified rollback properties:

1. target component: `remote-commerce`.
2. incident severity: `sev-2`.
3. detection budget: 120000 ms, observed 64000 ms.
4. mitigation budget: 300000 ms, observed 181000 ms.
5. total budget: 420000 ms, observed 245000 ms.
6. fallback order: `current -> environment-overlay -> lkg -> csr-fallback`.
7. selected fallback stage: `lkg`.
8. selected artifact: `artifact-remote-commerce-2026-04-15-007`.
9. kill-switch flag: `mv.wave2.remote-commerce.disable`.
10. rollback telemetry: `evidence/wave2/rollback-kill-switch/telemetry.jsonl`.

The drill also proves revocation precedence for bad current and environment-overlay artifacts.

## Wave 3 Production Controls

The Wave 3 production rollout strategy defines the production remote-commerce kill switch as `mv.wave3.remote-commerce.disable`, owned by `commerce-experience`, with runbook `runbooks/wave3/remote-commerce.md#kill-switch`.

Production rollback triggers:

1. `client-error-rate >0.5% for 5m` triggers rollback.
2. `signed-manifest-validation-failure >0` triggers disable.

The production remote-failure and trust-policy SOPs require rollback decision telemetry, revocation evidence when used, and owner approval before rollout resume.

## Certification Result

Rollback is certified for production because the Wave 2 drill proves containment within SLO budgets and deterministic fallback ordering, and Wave 3 maps the same controls to the production kill switch and production rollback triggers.
