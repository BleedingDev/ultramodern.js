# MIGRATION-PLAYBOOK-0001: Existing Teams to Micro Verticals

- Status: Proposed
- Date: 2026-04-29
- Related Plan: `.codex/plans/ultramodern-complete-mv-delivery-waves.plan.md`
- Related Lanes: `uw4-03`, `uw4-04`
- Evidence Index: `docs/super-app-rfc-adr/evidence/mv-wave4/compatibility-sunset/evidence-index.md`
- Primary References:
  - `docs/super-app-rfc-adr/ADR-0010-mv-wave0-contract-first-gates.md`
  - `docs/super-app-rfc-adr/ADR-0011-mf-vs-garfish-runtime-parity-contract.md`
  - `docs/super-app-rfc-adr/ADR-0012-mv-topology-manifest-and-zephyr-profile.md`
  - `docs/super-app-rfc-adr/DELIVERY-0001-micro-vertical-reference-delivery.md`

## 1. Purpose

This playbook gives existing Modern.js teams a concrete path from current applications toward the Micro Vertical shell, remote, and service model without reintroducing raw-handler API lanes.

The target model is the one in `DELIVERY-0001-micro-vertical-reference-delivery.md`:

1. start or remain in one `presetUltramodern(...)` app while ownership is unstable.
2. split stable feature slices into shell-owned route modules.
3. graduate isolated slices into Module Federation remotes.
4. move cross-project data and workflows into strict Effect HttpApi contracts.

## 2. Migration Principles

1. Do not delete or weaken Compat coverage to create migration pressure.
2. Promote by evidence, not by framework preference.
3. Keep shell source reference-based: use topology IDs, not environment URLs.
4. Preserve rollback before increasing rollout percentage.
5. Treat design-system, trust-policy, and remote failures as independent incident classes.
6. Require owner review before moving a route, remote, service, or shared design-system dependency across lane boundaries.

## 3. Team Intake

Before changing runtime, routing, or service shape, the owning team records these facts in the migration ticket or rollout evidence package:

| Input | Required answer |
| --- | --- |
| Current lane | Golden, Compat, or Experimental under `ADR-0010-mv-wave0-contract-first-gates.md`. |
| Runtime surface | Module Federation, Garfish, or mixed. |
| Router surface | TanStack, React Router, or mixed. |
| Service surface | Effect HttpApi, in-process handlers, or mixed legacy handlers to remove. |
| Topology IDs | Shell, remote, and service IDs that will remain stable after extraction. |
| Owners | Vertical owner, platform owner, service owner, design-system owner when applicable. |
| Rollback controls | Kill switch, LKG candidate, CSR or maintenance fallback, and revocation path. |
| Evidence gap | The first missing artifact compared with the Tractor Explore/Decide/Checkout target gates. |

The live release-gate evidence contracts are the repository's shape examples only. They define required file roles and metadata; they do not certify a migration or production rollout:

1. `docs/super-app-rfc-adr/evidence/release-candidate/current/`
2. `docs/super-app-rfc-adr/evidence/module-certification/current/`

## 4. Phased Migration Path

### Tractor Target Split

Existing one-remote commerce demos or applications should migrate toward the
Tractor split only when ownership is clear:

| Existing surface | Target owner | Notes |
| --- | --- | --- |
| Catalog landing, recommendations, navigation/header/footer, dealer or store picker | Explore vertical | Owns `/tractors`, `/stores`, Explore MF exposes, and `/explore-api/explore/*`. |
| Product detail, comparison, configuration, option selection | Decide vertical | Owns `/tractors/:slug`, product/configuration operations, and `/decide-api/decide/*`. |
| Cart, add-to-cart, checkout, order confirmation | Checkout vertical | Owns `/cart`, `/checkout`, `/checkout/thank-you/:orderId?`, cart/order operations, and `/checkout-api/checkout/*`. |
| Shared design tokens and primitive styling values | Shared design tokens package | Owns `./tokens.css`; do not move feature composites here. |
| Cross-cutting orchestration, topology, fallback policy | Shell | Owns assembly only; it should not take over vertical route-local behavior. |

Preserve one-package ownership while splitting. A vertical package owns its UI,
Effect BFF contract, generated client, route-owned `localisedUrls`, dynamic
locale JSON, vertical CSS layer, MF manifest, Cloudflare Worker output, and
build marker. Do not split the default vertical-owned API into a separate
service unless the operation has a real cross-vertical owner and propagation
contract.

Before extracting a slice, answer:

1. Can one team own the route, API, translations, CSS, fallback, and incident
   response?
2. Can the shell consume it through topology and MF references without source
   URL rewrites?
3. Can UI, API, CSS, i18n JSON, and MF manifest markers be proven from the same
   selected version?
4. Does rollback disable or pin only this vertical without breaking unrelated
   routes?

### Phase 0: Stabilize the Existing Lane

Use this phase for teams still running Compat or Experimental combinations.

Required actions:

1. Classify the current application against `ADR-0010-mv-wave0-contract-first-gates.md`.
2. Stop adding new production dependencies on Experimental combinations unless an exception is approved under this playbook.
3. Preserve existing regression coverage until the target route, service, or remote has passed the equivalent MV gate.
4. Record every cross-vertical source import, hardcoded remote URL, hardcoded service URL, and shell-owned feature composite as a migration blocker.

Exit criteria:

1. Owners are named for each route subtree, remote candidate, service boundary, and shared design-system dependency.
2. Each production path has an identified rollback owner and fallback behavior.
3. No migration step requires deleting an existing Compat gate before the replacement evidence exists.

### Phase 1: Move to Reference-Based Topology

Use `ADR-0012-mv-topology-manifest-and-zephyr-profile.md` as the contract.

Required actions:

1. Replace shell references to environment-specific remote or service URLs with stable topology reference IDs.
2. Add immutable artifact metadata for each remote target: URL, digest, SRI value, runtime digest when applicable, and attestation when production-bound.
3. Define environment overlays for local, preview, staging, and production without changing source-level route IDs.
4. Define LKG and revocation behavior before enabling independent remote rollout.
5. Add kill switches that target topology reference IDs, not URLs or route strings.

Exit criteria:

1. A selected topology manifest can move a remote or service between environments without shell source edits.
2. Revocation wins over current, overlay, LKG, and CSR fallback.
3. Fallback telemetry is emitted for every degraded path.

### Phase 2: Extract Route Ownership

Use `DELIVERY-0001-micro-vertical-reference-delivery.md` section 3 as the delivery model.

Required actions:

1. Keep unstable features shell-local.
2. Move stable route subtrees behind explicit ownership metadata.
3. Remove cross-vertical source imports before promoting a subtree to remote ownership.
4. Define remote-local loader, mutation, and degradation behavior.
5. Preserve route IDs and shell topology IDs across extraction.

Exit criteria:

1. The shell owns global route assembly and platform policy.
2. The vertical owns its route subtree and remote-local behavior.
3. The route can tolerate version skew through trust and compatibility checks.
4. The owner can roll back the vertical without redeploying the shell.

### Phase 3: Promote to a Remote

Use Module Federation as the Golden target, while preserving Garfish as the Compat bridge where existing workloads still depend on it.

Required actions:

1. Produce parity evidence using `ADR-0011-mf-vs-garfish-runtime-parity-contract.md`.
2. Cover manifest discovery, origin trust, integrity, attestation, runtime compatibility, lifecycle, SSR or hydration fallback, cache and version pinning, failure, timeout, and telemetry.
3. Record each known non-equivalence instead of hiding it behind a render-success pass.
4. Add fallback UI and telemetry for timeout, integrity, compatibility, and lifecycle failures.
5. Keep the Compat runtime lane active until the replacement remote has passed rollout, rollback, trust, and review gates.

Exit criteria:

1. Every blocking fallback emits the canonical fallback taxonomy from `ADR-0011-mf-vs-garfish-runtime-parity-contract.md`.
2. The shell survives remote failure and unaffected components remain available.
3. Runtime promotion has owner review and a linked evidence record.

### Phase 4: Promote Data and Workflow Boundaries

Use Effect HttpApi as the generated service target. Existing raw handlers are migration inputs to remove, not generated target architecture.

Required actions:

1. Identify operations consumed by more than one app, remote, or deployment boundary.
2. Move those operations behind explicit service contracts with auth, session, locale, and trace propagation.
3. Prefer Effect HttpApi for new strict HTTP contracts.
4. Keep raw handler usage out of generated API modules; model exceptions as separate transport decisions.
5. Avoid in-process convenience calls across future extraction boundaries.

Exit criteria:

1. Service callers resolve base URLs through topology service references.
2. Trace, locale, auth, and session propagation are tested at the boundary.
3. Rollback and incident owners are recorded for the service and its consumers.

### Phase 5: Certify Production Rollout

Use the live release-gate evidence contracts listed in §3 as the structure for
any future production evidence package; they do not certify a migration or
production rollout.

Required actions:

1. Roll out through development, staging, canary, and production gates.
2. Enforce signed manifests for production.
3. Record observed SLOs and rollback triggers.
4. Prove kill-switch behavior, fallback ordering, and LKG selection.
5. Attach owner approvals before production promotion and before rollout resume after an incident.

Exit criteria:

1. A newly generated production evidence package follows one of the live release-gate evidence contracts listed in §3.
2. The package includes extraction evidence covering stable topology IDs and no shell refactor.
3. The package includes fallback evidence covering shell survivability and telemetry.
4. The package includes rollback evidence covering mitigation within budget.
5. The package includes trust evidence covering digest, SRI, attestation, signed manifest enforcement, and revocation precedence.
6. The package includes review evidence with vertical-owner and platform-production-readiness approval.

## 5. Compat Lane Protection

Existing teams may keep legacy regression gates while actively migrating, but generated target work is constrained:

1. Existing production workloads keep regression gates while being migrated.
2. New production features should target the strict Effect HttpApi path unless the exception policy approves a separate non-HTTP transport.
3. Legacy changes must not bypass topology, trust, fallback, rollback, owner, or incident evidence.
4. Mixed unowned experiments are not production-supported.
5. A legacy gate can be removed only after the replacement strict path has passed the matching evidence gate and one release cycle has completed without a lane-specific rollback.

## 6. Rollback and Exception Policy

Rollback is mandatory for every migration phase that changes runtime, topology, route ownership, service boundaries, design-system dependencies, or production rollout percentage.

Required rollback controls:

1. per-remote disable.
2. per-service disable when service topology changes.
3. per-design-system remote disable or consumer pin rollback when DS contracts change.
4. per-vertical maintenance or CSR fallback.
5. LKG manifest fallback.
6. revocation precedence over current, overlay, LKG, and CSR fallback.
7. telemetry for fallback selection and rollback decision.

Exceptions are allowed only when all of these are true:

1. the owning team states why Golden migration is blocked.
2. the exception has an owner, reviewer, expiration date, and affected topology IDs.
3. the exception preserves existing Compat regression coverage.
4. the exception does not bypass digest, SRI, attestation, origin, runtime compatibility, or revocation policy.
5. the owning team identifies an executable, owner-approved incident procedure for migration failures.

## 7. Owner and Review Requirements

Every migration step needs named owners before implementation starts:

| Change | Required owner | Required reviewer |
| --- | --- | --- |
| Route subtree ownership | Vertical owner | Platform routing owner |
| Remote topology or runtime | Vertical owner | Platform runtime owner |
| Service boundary | Service owner | Consuming vertical owner and platform service owner |
| Design-system dependency | Design-system owner | Affected vertical owner |
| Production rollout | Vertical owner | Platform production-readiness reviewer |
| Compat exception | Owning team | Architecture or release-governance reviewer |
| Experimental production request | Owning team | Architecture board and production-readiness reviewer |

Reviewers must verify evidence, not only approve intent.

## 8. Team Checklist

Use this checklist as a sequence, not as a tracking system:

1. classify the lane.
2. name owners and reviewers.
3. remove hardcoded remote and service URLs.
4. define topology IDs, overlays, LKG, revocation, and kill switches.
5. isolate route ownership.
6. remove cross-vertical source imports.
7. add runtime parity or compatibility evidence.
8. add service-boundary propagation evidence.
9. add design-system compatibility evidence when the vertical consumes shared DS surfaces.
10. run staged rollout.
11. attach rollout, extraction, fallback, rollback, trust, and review evidence.
12. remove only the Compat gates whose replacement evidence is already green.

## 9. Done State

A team has completed migration when:

1. the production path is Golden or has an approved, unexpired Compat exception.
2. topology, trust, fallback, and rollback evidence plus an executable incident procedure are linked.
3. the shell can roll forward or back through manifest selection without source edits.
4. the vertical can fail without taking down unrelated verticals.
5. no Experimental combination remains in the production path.
