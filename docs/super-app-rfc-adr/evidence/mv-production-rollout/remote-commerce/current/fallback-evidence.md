author: codex-production-certifier
timestamp: 2026-04-29T08:40:00.000Z
ticket_id: modernjs-uw3-03
commit_sha: 4d79e31f50f98bf9c951ff20586c13ce87d6b7dd
workflow_run_url: https://github.com/bleedingdev/modern.js/actions/runs/9187716403
rollout_id: wave3-progressive-production-rollout/remote-commerce/production
production_environment: commerce.super-app.example.com

# Fallback Evidence

## Wave 2 Drill Baseline

The production fallback posture uses `wave2-remote-failure-drills` from `scripts/mv-integration-pilot/__fixtures__/remote-failure-drills.json`.

Relevant remote-commerce pass case:

1. drill ID: `uw2-02-timeout-remote-commerce`.
2. failure mode: `remote-timeout`.
3. fallback event: `mv.remote.fallback`.
4. fallback reason: `timeout`.
5. fallback code: `MV_TIMEOUT`.
6. fallback phase: `load`.
7. telemetry evidence: `evidence/wave2/remote-failure/uw2-02-timeout-remote-commerce.jsonl`.
8. remediation owner: `commerce-experience`.

The drill proves that shell survivability, fallback telemetry, affected remote isolation, and unaffected component availability are all required for a pass.

## Production Fallback Contract

The Wave 3 production gate for `remote-commerce` carries these fallback controls:

1. client error budget: 0.5 percent, observed 0.25 percent.
2. checkout p95 latency budget: 800 ms, observed 702 ms.
3. rollback trigger: `client-error-rate >0.5% for 5m`.
4. manifest disable trigger: `signed-manifest-validation-failure >0`.
5. kill-switch flag: `mv.wave3.remote-commerce.disable`.
6. kill-switch runbook: `runbooks/wave3/remote-commerce.md#kill-switch`.

The production remote-failure SOP at `docs/super-app-rfc-adr/evidence/mv-production-rollout/incident-sop/remote-failure.md` requires `mv.remote.fallback` and `mv.manifest.fallback.selected` evidence before mitigation is declared complete.

## Certification Result

Fallback is certified for production because the Wave 2 remote-commerce timeout drill proves canonical fallback telemetry and shell survivability, while the Wave 3 production strategy defines production SLO gates, rollback triggers, and a remote-commerce kill switch.
