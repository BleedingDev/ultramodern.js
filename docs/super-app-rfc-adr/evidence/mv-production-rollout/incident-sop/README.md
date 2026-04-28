# Micro Vertical Production Incident SOPs

These SOPs are production-rollout evidence inputs for `uw3-03` certification. They translate the Wave 2 pilot evidence into operator actions for production Micro Vertical incidents.

## SOP Index

| SOP | Primary incident | Wave 2 evidence inputs |
| --- | --- | --- |
| [Remote failure](./remote-failure.md) | MF remote timeout, entry load failure, or isolated remote unavailability | `wave2-remote-failure-drills`, `uw2-05-rollback-kill-switch-slo` |
| [Design-system failure](./design-system-failure.md) | Horizontal design-system bad release, token/API breakage, or contract-version skew | `uw2-03-design-system-bad-release`, `uw2-05-rollback-kill-switch-slo` |
| [Trust-policy failure](./trust-policy-failure.md) | Origin, integrity, attestation, runtime digest, or revocation policy violation | `uw2-02-integrity-remote-design-system`, `uw2-05-rollback-kill-switch-slo` |

## Shared Production Assumptions

1. The production shell selects remotes and services only through the topology manifest environment overlay.
2. Remote artifacts are immutable, digest-addressed, SRI-protected, and backed by provenance or attestation evidence.
3. Revocation wins over current, environment-overlay, LKG, and CSR fallback selection.
4. Kill switches target topology reference IDs such as `remote-commerce`, not deployment URLs or route strings.
5. Every degraded path emits fallback or rollback telemetry before the incident is declared mitigated.

## Evidence Update Rule

After each incident, attach the operator log, selected topology manifest, fallback decision event, telemetry evidence, and post-incident owner approval to the `uw3-03` certification package. If the incident changes support commitments, also update the production support matrix before resuming rollout.
