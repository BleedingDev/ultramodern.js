# MV Wave 4 Compatibility Sunset Evidence Index

- Status: Proposed Wave 4 evidence index
- Date: 2026-04-29
- Related Plan: `.codex/plans/ultramodern-complete-mv-delivery-waves.plan.md`
- Related Lanes: `uw4-03`, `uw4-04`

## Purpose

This index records the Wave 0-3 evidence used by:

1. `MIGRATION-PLAYBOOK-0001-existing-teams-to-mv.md`
2. `SUNSET-DECISION-0001-compatibility-lanes.md`

It is not a new support policy. It is the evidence map for deciding which lanes stay default, which lanes stay constrained for migration, and which mixed lanes leave production support.

## Evidence Map

| Evidence | Path | Sunset relevance |
| --- | --- | --- |
| Wave 0 contract gate | `docs/super-app-rfc-adr/ADR-0010-mv-wave0-contract-first-gates.md` | Defines Golden, Compat, and Experimental support tiers before implementation work. |
| Runtime parity contract | `docs/super-app-rfc-adr/ADR-0011-mf-vs-garfish-runtime-parity-contract.md` | Requires explicit parity evidence and non-equivalence disposition before Module Federation can be treated as canonical. |
| Topology and Zephyr profile | `docs/super-app-rfc-adr/ADR-0012-mv-topology-manifest-and-zephyr-profile.md` | Defines topology indirection, immutable artifacts, LKG fallback, revocation, kill switches, and vanilla Zephyr constraints. |
| Reference delivery model | `docs/super-app-rfc-adr/DELIVERY-0001-micro-vertical-reference-delivery.md` | Defines the intended migration path from shell-local slices to remotes and strict service contracts. |
| Production rollout | `docs/super-app-rfc-adr/evidence/mv-production-rollout/remote-commerce/current/rollout-evidence.md` | Certifies one production vertical with progressive rollout, signed manifest enforcement, SLOs, and owner approvals. |
| Extraction | `docs/super-app-rfc-adr/evidence/mv-production-rollout/remote-commerce/current/extraction-evidence.md` | Proves stable topology IDs and URL indirection across independent deployment. |
| Fallback | `docs/super-app-rfc-adr/evidence/mv-production-rollout/remote-commerce/current/fallback-evidence.md` | Proves shell survivability, canonical fallback telemetry, and production kill-switch mapping. |
| Rollback | `docs/super-app-rfc-adr/evidence/mv-production-rollout/remote-commerce/current/rollback-evidence.md` | Proves deterministic fallback order, LKG selection, revocation precedence, and mitigation SLOs. |
| Trust | `docs/super-app-rfc-adr/evidence/mv-production-rollout/remote-commerce/current/trust-evidence.md` | Proves signed production manifests, digest, SRI, attestation, revocation, and owner metadata. |
| Design system | `docs/super-app-rfc-adr/evidence/mv-production-rollout/remote-commerce/current/design-system-evidence.md` | Proves isolated design-system rollback for an affected consumer without disabling unrelated verticals. |
| Review | `docs/super-app-rfc-adr/evidence/mv-production-rollout/remote-commerce/current/review-evidence.md` | Records vertical-owner and platform-production-readiness review for the first production certification. |
| Incident SOPs | `docs/super-app-rfc-adr/evidence/mv-production-rollout/incident-sop/README.md` | Carries Wave 2 drills into production operator actions for remote, design-system, and trust-policy incidents. |

## Evidence-Based Findings

1. Golden has enough evidence to remain the target default for new MV work because the Wave 3 `remote-commerce` package demonstrates signed manifest enforcement, stable topology IDs, fallback telemetry, rollback SLOs, kill-switch mapping, trust controls, design-system isolation, and owner review.
2. Compat still has a migration role because Wave 0 explicitly preserved React Router, Hono, and Garfish as compatibility surfaces and ADR-0011 still requires parity evidence and non-equivalence disposition before runtime promotion becomes unconditional.
3. Experimental mixed combinations do not have production certification evidence. Wave 0 permits them only as explicit opt-in smoke lanes, and Wave 3 certification does not expand that status.

## Decision Inputs

The Wave 4 lane decision should use these inputs:

1. Keep Golden as the default production and new-work lane.
2. Constrain Compat to existing workloads, regression coverage, and migration bridges.
3. Sunset Experimental as a production-support category while preserving bounded smoke coverage for research and exception validation.
4. Require any exception to cite the exact evidence above that it preserves or extends.
