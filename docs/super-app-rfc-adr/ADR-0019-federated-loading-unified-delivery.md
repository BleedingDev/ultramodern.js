# ADR-0019: Federated Loading, Unified Delivery

- Status: Accepted
- Date: 2026-07-03
- Decision Type: MicroVertical delivery contract
- Related:
  - `../../CONTEXT.md`
  - `DELIVERY-0001-micro-vertical-reference-delivery.md`
  - `WORKSPACE-0001-micro-vertical-workspace-scaffolding.md`
  - `OPERATIONS-0001-micro-vertical-certification-and-operations.md`
  - `ADR-0018-backend-federation-contract.md`

## 1. Context

UltraModern uses Module Federation and platform adapters to compose MicroVerticals at runtime. Earlier documents sometimes described remotes and services as independently released pieces that tolerate version skew. That wording is valid only across separate delivery units. It is wrong inside one MicroVertical, where frontend, API, and backend/server capability must come from the same source revision and be promoted together.

## 2. Decision

UltraModern MicroVerticals use federated loading with unified delivery. A MicroVertical has one delivery-unit identity, and every UI, API, and server composition surface for that MicroVertical derives from that identity. Cloudflare and Node.js are platform surfaces for the same delivery unit, not separate version streams. The shell may compose multiple MicroVertical delivery units, but it must not compose mismatched surfaces inside one MicroVertical.

The delivery-unit record is the single identity root. It may point at multiple runtime artifacts, but all artifacts represent the same source revision and build marker. Surface-level marker checks are defense in depth; they are not the primary source of truth.

## 3. Invariants

1. One MicroVertical version has one delivery-unit record.
2. One delivery-unit record has one build marker.
3. UI, API, and backend/server addresses are derived from the delivery-unit record, not configured as independent promotion choices.
4. Promotion and rollback happen at the MicroVertical delivery-unit boundary.
5. A marker mismatch inside one MicroVertical fails closed and is telemetry-visible.
6. Cross-MicroVertical skew is allowed only between separate delivery units, such as `checkout@17` composed with `catalog@21`.
7. Horizontal remotes, such as a design-system remote, are separate delivery units; their independence does not permit FE/API/backend drift inside a MicroVertical.
8. A service that is the server capability of a MicroVertical belongs to that MicroVertical delivery unit. A cross-vertical service is a separate delivery unit and must be modeled as such.

## 4. Consequences

Documentation and tooling should use "federated loading" for the mechanism and "delivery unit" for the release boundary. Existing references to independent release trains or version-skew rehearsal must be read as cross-delivery-unit compatibility, not as permission to mix frontend, API, and backend revisions inside one MicroVertical.

In-flight promotion behavior remains a platform decision, but it must preserve the same invariant: either reload/fail the old UI when it reaches a new delivery unit, or keep whole old and new delivery units routable side by side. It must never route an old UI to a new backend as a successful MicroVertical state.
