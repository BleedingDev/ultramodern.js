author: codex-production-certifier
timestamp: 2026-04-29T08:40:00.000Z
ticket_id: modernjs-uw3-03
commit_sha: 4d79e31f50f98bf9c951ff20586c13ce87d6b7dd
workflow_run_url: https://github.com/bleedingdev/modern.js/actions/runs/9187716403
rollout_id: wave3-progressive-production-rollout/remote-commerce/production
production_environment: commerce.super-app.example.com

# Incident Evidence

## SOP Coverage

Production incident handling for `remote-commerce` is covered by the SOP package under `docs/super-app-rfc-adr/evidence/mv-production-rollout/incident-sop`.

Certified SOPs:

1. remote failure: `remote-failure.md`.
2. trust-policy failure: `trust-policy-failure.md`.
3. design-system failure: `design-system-failure.md`.

The SOP index states that these documents translate Wave 2 pilot evidence into operator actions for production Micro Vertical incidents.

## Production Incident Controls

Shared production assumptions:

1. the production shell selects remotes and services only through topology manifest environment overlays.
2. remote artifacts are immutable, digest-addressed, SRI-protected, and backed by provenance or attestation evidence.
3. revocation wins over current, environment-overlay, LKG, and CSR fallback selection.
4. kill switches target topology reference IDs such as `remote-commerce`.
5. every degraded path emits fallback or rollback telemetry before mitigation is declared complete.

## Wave 2 Evidence Inputs

The SOPs reference these Wave 2 drills:

1. `wave2-remote-failure-drills` for timeout, network, and integrity fallback behavior.
2. `uw2-03-design-system-bad-release` for horizontal design-system contract rollback.
3. `uw2-05-rollback-kill-switch-slo` for rollback ordering, revocation precedence, kill-switch use, and incident SLO budgets.

## Certification Result

Incident readiness is certified because production SOPs exist for the expected remote, trust-policy, and design-system incidents, and each SOP names the Wave 2 drill evidence and required post-incident evidence updates for the `uw3-03` package.
