# GOVERNANCE-0001: Micro Vertical Extraction Governance

- Status: Proposed
- Date: 2026-04-29
- Related Plan: `.codex/plans/ultramodern-mv-extraction-governance.plan.md`
- Depends on:
  - `BOUNDARY-0001-framework-core-vs-module-vs-external-matrix.md`
  - `SDK-0001-module-sdk-contracts.md`
  - `ADR-0015-mv-ownership-and-blast-radius-gates.md`
  - `MIGRATION-PLAYBOOK-0001-existing-teams-to-mv.md`
  - `scripts/boundary-guards/profile.json`

## 1. Purpose

This document defines the governance rules for deciding when code stays shell-local, when it graduates into a Module Federation remote, and when it becomes an independent service.

The rules keep Micro Verticals from becoming a distributed monolith. They also keep framework core domain-neutral by putting product ownership, extraction decisions, and review policy in auditable downstream contracts.

## 2. Extraction Rubric

### 2.1 Keep a feature shell-local when

1. route ownership is unstable.
2. the feature depends on global navigation or shell-only session bootstrapping.
3. release cadence is still shared with the shell.
4. independent failure isolation would not change the user outcome.
5. loader/action logic still imports shell implementation details.

Shell-local does not mean unowned. The route subtree still needs a named owner before it can be promoted.

### 2.2 Promote to a remote when

All of these must be true:

1. route ownership is stable.
2. the vertical can render a degraded UI when remote loading fails.
3. host and remote can tolerate version skew.
4. remote trust metadata and compatibility digest are available.
5. shell imports only remote contracts, never remote implementation source.
6. fallback telemetry is emitted for timeout, integrity, compatibility, lifecycle, and unavailable states.

### 2.3 Promote to a service when

All of these must be true:

1. more than one app, remote, or deployment boundary consumes the operation.
2. trace, locale, auth, and session propagation must remain stable across process boundaries.
3. error envelope and retry policy need an explicit contract.
4. service ownership and incident ownership are named.
5. topology metadata can resolve the service reference without shell source edits.

Effect is the default path for new strict service contracts. Hono remains a compatibility lane when explicitly declared and covered.

## 3. Ownership Metadata

Every extraction candidate needs metadata that can be reviewed before code moves:

| Target | Required metadata |
| --- | --- |
| Route subtree | route ID, path globs, vertical owner, shell reviewer, fallback owner |
| Remote | remote ID, manifest URL reference, compatibility digest, trust policy, vertical owner |
| Service | service ID, operation contract, runtime lane, service owner, consuming verticals |
| Shared package | package ID, allowed exports, consumer list, owner, impacted vertical reviewers |

The canonical schema is `docs/super-app-rfc-adr/contracts/mv-ownership.schema.json`.

## 4. Shared Package Governance

Shared packages are the highest-risk path back to monolith drift. They must stay intentionally narrow.

Allowed:

1. tokens.
2. primitive UI.
3. generated clients.
4. domain-neutral utilities.
5. typed contracts with no runtime workflow behavior.

Disallowed:

1. feature composites shared across verticals.
2. workflow state machines.
3. remote-local loader/action logic.
4. service implementation shortcuts.
5. vertical entity lifecycle rules.

If a package has cross-vertical consumers, changes require impacted-vertical review under the ownership and blast-radius gates.

## 5. Review Playbook

Every extraction PR or migration ticket must answer:

1. What is the current lane: Golden, Compat, or Experimental?
2. Which route, remote, service, or shared package owner is accountable?
3. Which topology IDs change?
4. Which consumers are direct and transitive?
5. Which fallback behavior is available before rollout?
6. Which evidence files prove route, remote, service, trust, rollback, and review readiness?
7. Which Compat gates remain until the replacement evidence passes?

Reviewers reject extraction when:

1. shell source imports remote implementation code.
2. remote source imports another vertical implementation.
3. service calls bypass generated or declared contracts.
4. shared packages expose feature composites.
5. topology references are replaced with environment URLs.
6. fallback or rollback behavior is undocumented.

## 6. Migration Path

Use `MIGRATION-PLAYBOOK-0001-existing-teams-to-mv.md` as the operational migration sequence:

1. stabilize the current lane.
2. move to reference-based topology.
3. extract route ownership.
4. promote to a remote.
5. promote data and workflow boundaries.
6. certify production rollout.

Migration must preserve upstream mergeability. Avoid broad framework rewrites, compatibility-lane deletion, or product taxonomy in framework core.

## 7. Acceptance Checklist

An extraction is ready when:

1. route, remote, service, and shared-package ownership is named.
2. boundary crossings use contracts, not source imports.
3. topology IDs are stable across environments.
4. fallback telemetry exists for remote and service degradation.
5. graph-aware blast-radius review identifies impacted consumers.
6. shared packages expose only approved surfaces.
7. rollout evidence links to rollback and incident SOPs.
