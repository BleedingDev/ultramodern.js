author: codex-production-certifier
timestamp: 2026-04-29T08:40:00.000Z
ticket_id: modernjs-uw3-03
commit_sha: 4d79e31f50f98bf9c951ff20586c13ce87d6b7dd
workflow_run_url: https://github.com/bleedingdev/modern.js/actions/runs/9187716403
rollout_id: wave3-progressive-production-rollout/remote-commerce/production
production_environment: commerce.super-app.example.com

# Trust Evidence

## Production Trust Inputs

The Wave 3 production gate enforces a signed manifest for `remote-commerce`:

1. policy: `docs/super-app-rfc-adr/wave3/signed-manifest.md#production`.
2. manifest: `manifests/wave3/remote-commerce/production/current.json`.
3. signature: `sigstore://rekor.example.internal/entries/remote-commerce/wave3-production`.
4. attestation: `attestations/wave3/remote-commerce/production.intoto.jsonl`.

The production rollout strategy marks `signedManifest.enforced` as `true`, so production selection cannot bypass policy, signature, or attestation checks.

## Wave 2 Trust Baseline

Trust shape is inherited from `wave2-integration-pilot-reference-topology` and `uw2-04-vertical-extraction-drill`:

1. immutable artifact IDs are used instead of mutable route URLs.
2. content digest, SRI integrity, SBOM digest, signature, and provenance attestation are present for the remote artifact.
3. revocation policy points at `docs/super-app-rfc-adr/wave2/revocation-policy.md#remote-commerce`.
4. ownership evidence binds `remote-commerce` to `commerce-experience` and `pd-commerce-experience`.

The trust-policy SOP at `docs/super-app-rfc-adr/evidence/mv-production-rollout/incident-sop/trust-policy-failure.md` carries the Wave 2 integrity failure pattern into production and explicitly forbids bypassing digest, integrity, attestation, origin, or runtime compatibility checks to restore traffic.

## Certified Checks

1. Production manifest enforcement is enabled.
2. Revocation wins over current, environment-overlay, LKG, and CSR fallback selection.
3. Artifact provenance is tied to the Wave 2 extraction artifact and carried forward through the Wave 3 production attestation reference.
4. Trust failure mitigation is covered by the production trust-policy SOP.

## Certification Result

Trust is certified for production because the rollout strategy requires signed production manifests and the Wave 2 topology evidence proves digest, integrity, signature, attestation, revocation, and owner metadata for the vertical artifact.
