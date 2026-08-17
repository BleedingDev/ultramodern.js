# MV Wave 4 Compatibility Sunset Evidence Index

- Status: Historical Wave 4 contract index; rollout evidence retracted
- Date: 2026-04-29
- Related Plan: `.codex/plans/ultramodern-complete-mv-delivery-waves.plan.md` (historical reference — `.codex/` planning artifacts were untracked from the repo in ce7c6b06ac and this path no longer exists in-tree)
- Related Lanes: `uw4-03`, `uw4-04`

## Purpose

This index records the Wave 0-3 contract and design documents retained as inputs for:

1. `MIGRATION-PLAYBOOK-0001-existing-teams-to-mv.md`
2. `SUNSET-DECISION-0001-compatibility-lanes.md`

It is not a new support policy. The former remote-commerce rollout and incident artifacts were deleted in `fc9caa4877` after they were found to be fabricated/self-certified; they are not evidence of production activity. The table below therefore maps only the retained contract documents.

## Evidence Map

| Evidence | Path | Sunset relevance |
| --- | --- | --- |
| Wave 0 contract gate | `docs/super-app-rfc-adr/ADR-0010-mv-wave0-contract-first-gates.md` | Defines Golden, Compat, and Experimental support tiers before implementation work. |
| Runtime parity contract | `docs/super-app-rfc-adr/ADR-0011-mf-vs-garfish-runtime-parity-contract.md` | Requires explicit parity evidence and non-equivalence disposition before Module Federation can be treated as canonical. |
| Topology and Zephyr profile | `docs/super-app-rfc-adr/ADR-0012-mv-topology-manifest-and-zephyr-profile.md` | Defines topology indirection, immutable artifacts, LKG fallback, revocation, kill switches, and vanilla Zephyr constraints. |
| Reference delivery model | `docs/super-app-rfc-adr/DELIVERY-0001-micro-vertical-reference-delivery.md` | Defines the intended migration path from shell-local slices to remotes and strict service contracts. |

> The former remote-commerce rollout and incident artifacts are intentionally absent from this map. They were not authenticated production evidence and must not be cited as certification.

## Evidence-Based Findings

1. The retained Wave 0-3 documents define the intended Golden, Compat, and Experimental tiers and the controls required for future promotion; they do not certify that a Golden production rollout occurred.
2. Compat still has a migration role because Wave 0 explicitly preserved React Router, Hono, and Garfish as compatibility surfaces and ADR-0011 still requires parity evidence and non-equivalence disposition before runtime promotion becomes unconditional.
3. Experimental mixed combinations do not have production certification evidence. Wave 0 permits them only as explicit opt-in smoke lanes; the deleted Wave 3 rollout material does not change that status.

## Decision Inputs

The Wave 4 lane decision should use these inputs:

1. Keep Golden as the default production and new-work lane.
2. Constrain Compat to existing workloads, regression coverage, and migration bridges.
3. Sunset Experimental as a production-support category while preserving bounded smoke coverage for research and exception validation.
4. Require any exception to cite the exact evidence above that it preserves or extends.
