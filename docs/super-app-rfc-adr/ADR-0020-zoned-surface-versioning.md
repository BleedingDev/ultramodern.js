# ADR-0020: Zoned Surface Versioning and Contract Evolution

- Status: Proposed
- Date: 2026-07-09
- Decision Type: Contract evolution policy
- Related:
  - `ADR-0012-mv-topology-manifest-and-zephyr-profile.md`
  - `ADR-0016-ultramodern-opinionated-defaults-contract.md`
  - `ADR-0018-backend-federation-contract.md`
  - `ADR-0019-federated-loading-unified-delivery.md`
  - `../../CONTEXT.md` (Coordinated Zone, Externally Published Surface)

## 1. Context

MicroVerticals consume each other's published surfaces in a full mesh: any
vertical, any shell, and applications outside the workspace may consume any
published surface (UI components via Module Federation, API surfaces via
GraphQL/REST/RPC). Delivery units deploy and roll back independently, so
version skew between a consumer and a provider is a normal runtime state, not
an error.

Three evolution policies were considered:

1. **Enforced backward compatibility** (additive-only changes, side-by-side
   surface versions for every breaking change).
2. **Stripe-style date versioning** (provider keeps dated versions alive and
   transforms between them).
3. **Zoned policy**: breaking changes are free inside the monorepo; stability
   is owed only to surfaces explicitly published for external consumption.

Enforced backward compatibility contradicts the project's explicit goal of
moving the whole codebase forward aggressively. Date versioning imposes
provider-side transform layers that are unjustified for a small team with few
external consumers.

## 2. Decision

Adopt the zoned policy.

### Coordinated Zone (the monorepo)

- A surface consumed only inside the monorepo may change breakingly at any
  time. The change that breaks a surface must update every in-repo consumer in
  the same change; CI proves the mesh green at merge time.
- Coordination applies to source only. Delivery units still deploy
  independently; the brief runtime skew while independently deployed verticals
  roll forward is a tolerated state, and consumers cover it with their
  degraded-state handling (typed fallback events per ADR-0019).
- No backward-compatibility obligations exist inside the zone. Reverting to
  a compatible pair is a per-unit rollback (runtime artifact repointing), not
  a compatibility guarantee.

### Externally Published Surfaces

- A surface consumed from outside the monorepo (separate-repo MicroVerticals,
  customer applications, foreign MF runtimes) must be explicitly marked as
  externally published. Unmarked surfaces owe external consumers nothing.
- Externally published surfaces follow semantic versioning. A breaking change
  ships as a new major exposed side by side with the previous major until
  known external consumers migrate.
- Semver majors materialize per surface kind: a new exposed MF path
  (e.g. `./checkout/v2`), a new API route prefix, or a new RPC contract
  version — the owning vertical chooses, consistent with its API style.
- External consumers load standard Module Federation entries
  (`mf-manifest.json` canonical, `remoteEntry.js` for any MF-capable
  runtime), so the policy is not UltraModern-specific.

Date-based versioning is explicitly deferred; revisit only if a surface
becomes a public product with many unknown consumers.

## 3. Consequences

- The codebase moves forward as one; no dead compatibility shims accumulate
  inside the monorepo.
- External publication becomes a deliberate, visible act with a cost
  (semver discipline), which discourages accidental external coupling.
- CI must be able to tell the two zones apart: a breaking diff on an
  externally published surface fails unless it lands as a new major; the same
  diff on an internal surface merely requires consumers updated in-change.
- During rollout windows, mixed provider/consumer revisions coexist at
  runtime even in-zone; degraded-state handling and delivery-unit identity
  validation (ADR-0019) are the safety nets, and they are mandatory, not
  optional.
