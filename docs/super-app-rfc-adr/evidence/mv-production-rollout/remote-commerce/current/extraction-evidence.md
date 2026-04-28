author: codex-production-certifier
timestamp: 2026-04-29T08:40:00.000Z
ticket_id: modernjs-uw3-03
commit_sha: 4d79e31f50f98bf9c951ff20586c13ce87d6b7dd
workflow_run_url: https://github.com/bleedingdev/modern.js/actions/runs/9187716403
rollout_id: wave3-progressive-production-rollout/remote-commerce/production
production_environment: commerce.super-app.example.com

# Extraction Evidence

## Certified Vertical

`remote-commerce` is the first production vertical certified under the Wave 3 rollout gates. The owning team is `commerce-experience`, and the production host remains `commerce.super-app.example.com`.

## Wave 2 Drill Baseline

The production certification inherits the extraction proof from `uw2-04-vertical-extraction-drill` in `scripts/mv-integration-pilot/__fixtures__/vertical-extraction.json`.

Certified extraction properties:

1. Shell remote references remain stable before and after extraction: `remote-commerce`, `remote-identity`, and `remote-design-system`.
2. Cart and checkout routes keep the same route IDs and entrypoints: `commerce-cart`, `commerce-checkout`, `commerce/CartRoute`, and `commerce/CheckoutRoute`.
3. Production URL indirection resolves through `https://deploy.example.internal/mf/remote-commerce/independent/current.json`.
4. The extracted artifact is `artifact-remote-commerce-2026-04-18-vertical-001` at `5.3.1-wave2.extract.1`.
5. Provenance is bound to Git SHA `a1d6d5025270f9a9ccdd8bc7c5471529fb6847ee`, build `gha-9180042201`, digest `sha256-6262626262626262626262626262626262626262626262626262626262626262`, and SLSA policy `slsa-v1.0-wave2-pilot`.

## Wave 3 Production Mapping

The Wave 3 production rollout gate in `scripts/mv-production-rollout/__fixtures__/rollout-strategy.json` promotes `remote-commerce` to 100 percent production after development, staging, and canary gates. The production gate references:

1. entry criteria `evidence/wave3/remote-commerce/production/entry.md`.
2. exit criteria `evidence/wave3/remote-commerce/production/exit.md`.
3. signed manifest `manifests/wave3/remote-commerce/production/current.json`.
4. production attestation `attestations/wave3/remote-commerce/production.intoto.jsonl`.

## Certification Result

Extraction is certified for production because the Wave 2 independent deploy proof keeps shell topology stable, and the Wave 3 production strategy promotes the same `remote-commerce` topology ID through environment overlays rather than route rewrites or unpinned URLs.
