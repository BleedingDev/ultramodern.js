# ADR-0015: Micro Vertical Ownership And Blast Radius Gates

- Status: Proposed
- Date: 2026-04-28
- Related Graph: `ultramodern-complete-mv-delivery-waves-plus-5-plans-10989c3972`
- Related Todos: `uw0-04`, `uw0-08`
- Coordinates With: `uw0-07`, `uw0-09`
- Depends on:
  - `BOUNDARY-0001-framework-core-vs-module-vs-external-matrix.md`
  - `ADR-0006-boundary-anti-pattern-checks.md`
  - `ADR-0007-module-certification-gates.md`
  - `DELIVERY-0001-micro-vertical-reference-delivery.md`
  - `contracts/mv-ownership.schema.json`

## 1. Context

Micro Vertical extraction needs an explicit ownership and blast-radius contract before a route subtree, MF remote, service, or shared package can move independently.

Existing boundary checks keep framework core domain-neutral, and module certification gates require onboarding evidence. The missing contract is the ownership metadata that tells gates:

1. who owns each route, remote, service, and shared package.
2. which paths belong to that ownership surface.
3. which graph consumers are impacted by a change.
4. when cross-vertical approval is mandatory.
5. which extraction boundary checks must block unsafe splits.

## 2. Decision

Add the Micro Vertical ownership schema:

1. `docs/super-app-rfc-adr/contracts/mv-ownership.schema.json`

The schema defines a profile-driven contract for:

1. multi-owner principals across `human`, `team`, `agent`, and `service-account` owners.
2. route, remote, service, and shared-package ownership targets.
3. path rules that map source globs to ownership targets and approval gates.
4. dependency-graph impact rules that require direct and transitive consumer analysis.
5. approval gates for owning verticals, impacted verticals, and platform owners.
6. extraction boundary checks for remote and service readiness.
7. support-matrix and incident hooks as gate inputs.

Root validation wiring is intentionally out of scope for this ADR. This document only defines the contract and the gate semantics that wiring must preserve.

## 3. Extraction Boundary Contract

### 3.1 Cross-vertical code boundaries

Micro Verticals must not import implementation code from another vertical.

Allowed crossing modes are limited to:

1. `api-only`: service calls through an explicit API contract.
2. `remote-contract-only`: MF host/remote interaction through declared remote metadata, compatibility digest, trust metadata, and fallback behavior.
3. `shared-primitive-only`: shared tokens, primitive UI, or domain-neutral utilities that expose no vertical workflow semantics.

Feature composites, loaders, workflow state machines, entity lifecycle rules, and vendor-specific behavior remain owned by their vertical or connector layer. They are not shared platform APIs.

### 3.2 Explicit runtime boundaries

Any extraction to a remote or service must declare the relevant runtime boundaries:

1. auth boundary.
2. session boundary.
3. trace boundary.
4. tenant and locale propagation boundary when user or request context crosses a process or deployment boundary.
5. fallback and trust boundary when MF remotes load independently.
6. compatibility boundary when host and remote versions may skew.

These boundary references are gate inputs, not optional documentation. A change that moves behavior across one of these boundaries without metadata must fail ownership validation once the validator is wired.

### 3.3 Remote extraction readiness

A route subtree can be promoted to an MF remote only when ownership metadata proves:

1. stable route ownership.
2. loader bridge contract.
3. fallback UI.
4. remote trust metadata.
5. compatibility digest.
6. telemetry hooks for fallback and runtime health.

This extends the Micro Vertical delivery rule that a route should stay shell-local while ownership is unstable or failure isolation is not useful.

### 3.4 Service extraction readiness

Data or workflow logic can be promoted to an independent service only when metadata proves:

1. API contract.
2. auth boundary.
3. session boundary.
4. trace boundary.
5. operation context propagation.
6. error envelope policy.
7. independent scale or failure boundary.

Effect-first contracts remain the preferred path for strict new service contracts. Hono remains a compatibility lane when explicitly declared.

## 4. Graph-aware Blast Radius

Ownership gates must use dependency graph inputs before deciding whether a change is local.

Required graph outputs are:

1. changed ownership targets.
2. direct consumers.
3. transitive consumers.
4. cross-vertical consumers.
5. support-matrix rows.
6. incident hooks.
7. approval plan.

The contract treats a change as higher risk when it:

1. crosses a vertical boundary.
2. changes a shared package consumed by more than one vertical.
3. changes a route subtree that is already remote-backed.
4. changes a service contract used by multiple routes, remotes, or apps.
5. introduces circular dependency risk.
6. leaves any graph consumer unowned.

Graph depth and consumer classification determine whether the gate can stay local to the owning vertical or must require cross-vertical approval.

## 5. Approval Gates

The default approval model is:

1. owning vertical approval for any owned target change.
2. impacted vertical approval when graph analysis finds cross-vertical consumers.
3. platform owner approval when framework-core, shared primitive, trust, fallback, compatibility, or release-gate behavior is affected.
4. incident owner approval when an active incident hook or degraded support-matrix row intersects the changed target.

Automated agents and service accounts may record evidence or perform mechanical validation, but they must not satisfy a human or team approval gate unless the gate explicitly allows that principal type.

## 6. Gate Inputs

The ownership contract consumes existing gate artifacts:

1. `scripts/boundary-guards/profile.json` for import and snippet guard references.
2. `scripts/release-gates/module-certification-profile.json` for onboarding evidence expectations.
3. support-matrix references for affected runtime lanes and operational commitments.
4. incident hooks for degraded remotes, contract regressions, rollout pauses, and support-tier changes.

The support-matrix and incident inputs are part of blast-radius evaluation. They can raise a local change into a cross-vertical approval path even when static imports look local.

## 7. Consequences

Positive:

1. route, remote, service, and shared-package ownership becomes machine-readable.
2. cross-vertical changes have explicit approval paths instead of relying on reviewer memory.
3. extraction readiness is tied to auth, session, trace, trust, fallback, compatibility, and telemetry evidence.
4. support and incident state can influence release risk before a change ships.

Tradeoff:

1. teams must maintain ownership metadata as routes and remotes move.
2. graph-aware gates require deterministic dependency graph inputs before they can be fully enforced.
3. emergency changes may need temporary incident-driven overrides that are auditable and time-bound.

## 8. Validation Commands

1. `node -e "JSON.parse(require('node:fs').readFileSync('docs/super-app-rfc-adr/contracts/mv-ownership.schema.json','utf8'))"`

## 9. Acceptance Criteria

1. `contracts/mv-ownership.schema.json` parses as JSON.
2. the schema supports human, team, agent, and service-account ownership principals.
3. the schema covers routes, remotes, services, shared packages, path rules, dependency-graph impact, approval gates, and extraction boundary checks.
4. this ADR defines cross-vertical import restrictions, graph-aware blast radius, and approval paths for impacted verticals and platform owners.
