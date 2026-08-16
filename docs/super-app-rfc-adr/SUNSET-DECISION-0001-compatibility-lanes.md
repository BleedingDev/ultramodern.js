# SUNSET-DECISION-0001: Compatibility Lane Sunset Path

- Status: Superseded by events (2026-06-12 fork cleanup, see `docs/research/fork-audit-2026-06-12-findings.md`). The Garfish compat lane (`packages/runtime/plugin-garfish`) was deleted outright, so Module Federation is the sole micro-frontend runtime surface: the ADR-0011 parity-evidence preconditions referenced in §1 item 2 and §8 item 3 are moot (ADR-0011 is itself Retired), and the Compat lane described below no longer exists in this repo. The former MV rollout and incident artifacts were deleted in `fc9caa4877` because they recorded rollout and incident outcomes that never happened; no authenticated production evidence is substituted here.
- Date: 2026-04-29
- Related Plan: `.codex/plans/ultramodern-complete-mv-delivery-waves.plan.md`
- Related Lanes: `uw4-03`, `uw4-04`
- Evidence Index: `docs/super-app-rfc-adr/evidence/mv-wave4/compatibility-sunset/evidence-index.md`
- Migration Playbook: `docs/super-app-rfc-adr/MIGRATION-PLAYBOOK-0001-existing-teams-to-mv.md`

## 1. Decision

Wave 4 adopts this lane disposition:

| Lane | Combination | Classification | Decision |
| --- | --- | --- | --- |
| Golden | TanStack + Effect + Module Federation | Keep | Default for new MV shell, remote, and service work. Promote production workloads here when evidence matches the Wave 3 `remote-commerce` package. |
| Compat | React Router + Hono + Garfish | Constrain | Keep for existing workloads, migration bridges, and regression coverage. Do not expand as the default for new production MV work. |
| Experimental | Mixed router, service, or runtime combinations | Sunset for production support | Remove as a production-support category. Preserve bounded smoke coverage only for explicit opt-in validation and approved exceptions. |

This decision preserves Compat lanes while making Golden the default path and preventing Experimental combinations from becoming implicit production commitments.

## 2. Evidence Basis

Wave 0 established the support tiers in `ADR-0010-mv-wave0-contract-first-gates.md`:

1. Golden: TanStack + Effect + Module Federation with full contract, failure, rollback, and certification checks.
2. Compat: React Router + Hono + Garfish with compatibility and migration checks.
3. Experimental: mixed combinations with smoke and explicit opt-in checks.

Wave 1-3 evidence supports promotion of Golden as the target default, not deletion of Compat:

1. `DELIVERY-0001-micro-vertical-reference-delivery.md` defines the intended path from one app to shell route modules, MF remotes, and strict Effect HttpApi service contracts.
2. `ADR-0011-mf-vs-garfish-runtime-parity-contract.md` requires parity evidence and known non-equivalence disposition before runtime canonicality claims.
3. `ADR-0012-mv-topology-manifest-and-zephyr-profile.md` defines topology IDs, immutable artifacts, environment overlays, LKG, revocation, and kill switches.

## 3. Lane Requirements

### Golden: Keep

Golden remains the production target and default for new MV work.

Allowed work:

1. new shell and remote work using TanStack + Module Federation.
2. new strict service contracts using Effect.
3. production rollout when the evidence package covers rollout, extraction, fallback, rollback, trust, design-system impact when applicable, and review.
4. Zephyr-compatible vanilla Modern.js deployment when `ADR-0012-mv-topology-manifest-and-zephyr-profile.md` constraints are satisfied.

Required gates:

1. topology manifest with stable IDs, immutable artifacts, overlays, LKG, revocation, and kill switches.
2. runtime trust and compatibility checks.
3. signed production manifests.
4. fallback telemetry for degraded paths.
5. rollback triggers and owner-approved resume.
6. vertical-owner and platform-production-readiness review.

### Compat: Constrain

Compat remains supported for existing workloads and migration bridges, but it is no longer the expansion lane.

Allowed work:

1. existing React Router routes that have not completed route-ownership extraction.
2. existing Hono handlers while consumers migrate to Effect or while Hono is the documented compatibility service surface.
3. existing Garfish runtime paths while MF parity evidence, non-equivalence dispositions, or rollout evidence is incomplete.
4. bug fixes and regression tests needed to keep migration safe.

Constraints:

1. no new production vertical should choose Compat when Golden can satisfy the same requirement.
2. no Compat change may bypass topology IDs, trust policy, fallback telemetry, rollback controls, or owner review.
3. no Compat lane may absorb Experimental mixed combinations without an exception.
4. Compat gates should be removed only after replacement Golden evidence is green and one release cycle has completed without lane-specific rollback.

### Experimental: Sunset for Production Support

Experimental combinations are no longer production-supported lanes.

Allowed work:

1. bounded smoke tests for explicit opt-in validation.
2. research spikes that do not create production support commitments.
3. exception validation when an architecture or release-governance reviewer approves a time-boxed migration need.

Sunset rules:

1. no Experimental combination can be the default production path.
2. no production rollout may depend on Experimental without an approved exception.
3. Experimental failures do not block Golden release unless they expose a shared contract violation.
4. Experimental coverage must stay smoke-level unless promoted through a written lane decision.

## 4. Sunset Path

The sunset path is staged so existing teams are not forced into unsafe cutovers.

| Stage | Action | Exit requirement |
| --- | --- | --- |
| Stage 1: Freeze | Stop new production adoption of Experimental and stop defaulting new production work to Compat. | New work records Golden as default or links an approved exception. |
| Stage 2: Inventory | Classify existing apps and verticals as Golden, Compat, or Experimental. | Each production path has owner, reviewer, topology IDs, runtime, router, service surface, and rollback controls recorded. |
| Stage 3: Bridge | Keep Compat regression coverage while Golden replacement evidence is produced. | Replacement path passes topology, trust, fallback, rollback, and owner-review gates. |
| Stage 4: Remove | Remove only the obsolete Compat or Experimental gate that is fully replaced. | One release cycle completes without lane-specific rollback or incident resume blocker. |
| Stage 5: Audit | Review sunset changes against Wave 4 evidence. | Architecture or release-governance reviewer confirms no production path remains on Experimental and all remaining Compat entries are exception-backed or migration-active. |

## 5. Rollback Policy

Any lane movement must be reversible before it is rolled out.

Required rollback controls:

1. per-remote disable.
2. per-service disable where service topology changes.
3. per-design-system remote disable or affected-consumer pin rollback.
4. per-vertical maintenance or CSR fallback.
5. LKG manifest fallback.
6. revocation precedence over current, environment overlay, LKG, and CSR fallback.
7. rollback telemetry and owner approval before rollout resume.

The former MV incident-SOP artifacts were deleted with the fabricated rollout package and are not executable operational references retained by this repository.

## 6. Exception Policy

Exceptions are time-boxed production allowances. They do not change the lane classification.

An exception must include:

1. affected topology IDs.
2. current lane and requested temporary lane behavior.
3. reason Golden cannot be used immediately.
4. migration owner and rollback owner.
5. architecture or release-governance reviewer.
6. expiration date or release boundary.
7. retained regression gates.
8. kill switch, LKG, revocation, and fallback telemetry plan.
9. incident SOP that applies if the exception fails.

Denied exception cases:

1. unpinned production remote or template artifact.
2. bypassed digest, SRI, attestation, origin, or runtime compatibility check.
3. no owner for affected route, remote, service, or design-system dependency.
4. no deterministic rollback path.
5. indefinite Experimental production usage.

## 7. Owner and Review Requirements

| Decision | Owner | Reviewer |
| --- | --- | --- |
| Keep Golden as default for new work | Platform runtime owner | Architecture or release-governance reviewer |
| Promote an existing workload to Golden | Vertical owner | Platform production-readiness reviewer |
| Retain Compat for a workload | Owning team | Architecture or release-governance reviewer |
| Remove a Compat gate | Owning team | Platform owner for the replaced surface |
| Allow an Experimental exception | Owning team | Architecture board and production-readiness reviewer |
| Resume rollout after rollback | Rollback owner | Affected vertical owner and platform production-readiness reviewer |

Reviewers must verify that the cited evidence exists and matches the affected topology IDs. Approval without evidence is not sufficient.

## 8. Drift Risks

Known risks to monitor during Wave 4:

1. Compat coverage can become a hidden default if new teams choose it for convenience instead of documented migration need.
2. Experimental smoke lanes can grow into production obligations if they are not expiration-bound.
3. MF promotion can overclaim parity if known non-equivalences from `ADR-0011-mf-vs-garfish-runtime-parity-contract.md` are not dispositioned.
4. Topology IDs can drift from source references if teams reintroduce environment URLs.
5. Design-system rollback can widen blast radius if consumer pinning and owner approvals are skipped.

## 9. Review Cadence

Review this decision at each release boundary until no production path depends on Experimental and all remaining Compat entries are either actively migrating or approved exceptions.

The review must compare current evidence against `docs/super-app-rfc-adr/evidence/mv-wave4/compatibility-sunset/evidence-index.md` and update this decision if new production evidence changes a lane classification.
