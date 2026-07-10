# UltraModern MicroVertical Context

This context defines language for UltraModern MicroVertical work. Implementation choices belong in ADRs; this file only defines the vocabulary. Delivery semantics are decided in `docs/super-app-rfc-adr/ADR-0019-federated-loading-unified-delivery.md`.

## Language

**MicroVertical**: A business capability owned end-to-end by one **Owner** and delivered as one versioned unit. It exists to enable independent fast deployment and isolation between owners — not to solve organisational scaling. All surfaces it ships (user-facing, API, server) come from the same source revision and are promoted together, so mixed-revision combinations are not valid states. A user-facing surface is optional: a MicroVertical may be headless. A shell may compose multiple MicroVertical delivery units, but each MicroVertical remains indivisible.
_Avoid_: Independent frontend remote, independently released backend, version-skewed vertical, team-org boundary.

**Owner**: The team or agent (or agent team) accountable for one or more MicroVerticals. One owner may own several MicroVerticals; a MicroVertical never has more than one owner.
_Avoid_: Org-chart team when it implies one-team-one-vertical.

**Vertical Split**: The decision to create a new MicroVertical. The domain test gates legitimacy: a distinct business capability nameable in domain language, with its own data and a plausible independent rollback. Owner contention decides timing: split when parallel owners keep colliding inside one vertical — a split costs a new delivery unit, contracts, and checks, so it is not free. If the capability cannot be named without mentioning another vertical, it is not a new MicroVertical — extend the existing one or extract a **Horizontal Remote**.
_Avoid_: One vertical per ticket, speculative splits.

**Data Ownership**: Each MicroVertical exclusively owns its persistent data. Storage infrastructure (e.g. one database) may be shared across MicroVerticals, but each MicroVertical's tables live in its own namespace (prefix) and belong to it alone. Another vertical reaches that data only through the owning MicroVertical's published surfaces, never directly.
_Avoid_: Shared tables, cross-vertical schema, cross-vertical SQL.

**Isolation Boundary**: A MicroVertical depends on another MicroVertical only through its published surfaces — a Composition Surface or a published API contract — never through source imports, internal modules, or another vertical's data. Reading foreign source for context is permitted; depending on it is not. MicroVerticals may live in separate repositories (including private ones), so nothing about the boundary may assume co-location in one workspace.
_Avoid_: Workspace import across verticals, monorepo-only contract.

**Vertical Dependency**: Exists when one MicroVertical actually consumes another's published surface, resolved at runtime in the Module Federation style. Dependencies are emergent from real consumption — manifests never declare dependence on one another. A cross-vertical import cycle (a module in vertical A importing from vertical B which imports back from A) is an invalid state; cycles are detected from the real consumption graph, not from declarations, and must be removed — usually by merging a wrongly split vertical or extracting a **Horizontal Remote**.
_Avoid_: Manifest-declared dependency, dependency lockstep.

**Surface Resolution**: The binding of a logical surface name to a concrete running artifact. Consumers refer only to logical names; resolution happens through a pluggable seam that must work with or without Zephyr Cloud — environment-configured manifest URLs as the always-available baseline, Zephyr snapshots/tags as the provider that makes rollback a pointer flip. A published surface exposes the standard Module Federation entries (`mf-manifest.json` as canonical, `remoteEntry.js` for any MF-capable runtime), so consumption is never exclusive to UltraModern.js.
_Avoid_: Hardcoded remote URLs in consumer code, Zephyr coupling outside the resolution seam.

**Degraded State**: The behaviour a consumer shows when a consumed surface is unavailable or incompatible. Absence of a surface is a normal state, not an exception: consuming a surface obliges the consumer to define its degraded state — a fallback UI for an embedded component, typed error handling for an API call. Faults isolate at the vertical boundary; one failing MicroVertical never takes down the shell or sibling verticals.
_Avoid_: Assumed availability, unhandled remote failure.

**Rollback**: Re-promoting a prior revision of one Delivery Unit. Rollback is per-vertical and expected to be near-instant via runtime artifact swapping (e.g. Zephyr Cloud) — it never requires rebuilding or redeploying other verticals.
_Avoid_: Coordinated rollback, roll-forward-only.

**Coordinated Zone**: The monorepo. A surface consumed only inside the Coordinated Zone may change breakingly at any time; the change that breaks it also updates every in-repo consumer, so the whole codebase moves forward together. Coordination applies to source only — deploys remain independent per Delivery Unit, and the brief runtime skew while independently deployed verticals roll forward is a tolerated state.
_Avoid_: Enforced backward compatibility inside the monorepo, lockstep deploys.

**Externally Published Surface**: A surface explicitly marked as consumable from outside the Coordinated Zone — by separate-repo MicroVerticals or external applications. Only these surfaces carry a stability promise: semantic versioning, with a breaking change shipped as a new major alongside the old until external consumers migrate. A surface not so marked owes external consumers nothing.
_Avoid_: Implicit external stability, date-based API versioning (revisit only if a surface becomes a public product).

**Delivery Unit**: The indivisible release boundary for one **MicroVertical**, **Shell**, or **Horizontal Remote**. A delivery unit may produce multiple runtime artifacts, but those artifacts represent one source revision and are validated as one unit.
_Avoid_: Deployment bundle when it implies a platform-specific package, independent service release.

**Composition Surface**: A runtime surface exposed by a **Delivery Unit** for another part of the system to consume. Module Federation may load a composition surface, but federation does not permit one MicroVertical to mix artifacts from different delivery units. Consumption is full mesh: any MicroVertical, the shell, or an external application outside the shell may consume any published surface.
_Avoid_: Independently deployable fragment, arbitrary swappable part.

**API Surface**: The published API contract of a MicroVertical. Each MicroVertical chooses the protocol that fits its capability — GraphQL, REST, or RPC (directly exposed functions) — so different MicroVerticals may expose different API styles. The protocol choice belongs to the owning vertical; the contract, once published, binds it.

**Component Surface**: A UI composition surface exposing components. A component may be smart (internally calls its own MicroVertical's API Surface) or dummy (purely presentational, fed by props). Both are valid published surfaces.

**Federated Loading**: Runtime loading through Module Federation or a platform adapter. Federated loading is a composition mechanism, not a release boundary.
_Avoid_: Independent frontend/backend deployment.

**Platform Surface**: A supported runtime environment for the same **Delivery Unit**. Platform surfaces may use different adapters, but they preserve the MicroVertical's delivery-unit identity.
_Avoid_: Separate product architecture, separate version stream.

**Platform Baseline**: The choices the platform dictates for every MicroVertical: React, TanStack Router, Effect, and Tailwind, pinned platform-wide to the newest stable and moved forward centrally. Composition-time singletons live here — a vertical never picks its own version of a baseline dependency. Inside the Coordinated Zone the baseline advances as one change across all verticals; an externally published MicroVertical declares which baseline range it is compatible with. Everything outside the baseline — API protocol, persistence and its tooling, internal libraries — is the owning vertical's free choice.
_Avoid_: Per-vertical React/router versions, singleton drift.

**Platform Overlay**: A stricter framework a downstream owner builds on top of UltraModern.js, closing freedoms the base leaves open — for example, mandating one ORM everywhere, or an authentication stack (Better Auth + Drizzle). An overlay may only narrow choices — it never relaxes the **Platform Baseline**. UltraModern.js itself stays a base to build on: any freedom it grants is an overlay's to close, and the platform must provide the tools to close it. Identity and authentication are deliberately outside the baseline: a super app without login is a valid product, so auth belongs to overlays, not the base.
_Avoid_: Forking the base framework to add opinions, baseline auth.

**Shell**: A thin composition host: it owns top-level routing, provisions the **Platform Baseline**, and composes MicroVertical surfaces. A shell is its own Delivery Unit but not a MicroVertical — it has no business capability, and business logic growing inside a shell must move into a vertical. Multiple shells are valid: a super app, an admin app, or an external customer's application may each compose overlapping sets of the same verticals.
_Avoid_: Business logic in the shell, the-one-shell assumption.

**Horizontal Remote**: A cross-vertical delivery unit, such as a design-system remote, that is not the frontend or backend half of a MicroVertical. A horizontal remote may have its own release boundary because it is a separate delivery unit.
_Avoid_: Shared backend of a MicroVertical, hidden platform subsystem.

## Flagged Ambiguities

**Remote**: Existing docs sometimes use remote to imply an independently released application. In MicroVertical discussions, remote should mean a **Composition Surface** of a **Delivery Unit** unless explicitly discussing a legacy remote or a **Horizontal Remote**.

**Swappable**: Existing language may imply swapping frontend/backend versions independently. In MicroVertical discussions, swappable means choosing a platform/runtime adapter or replacing an entire **Delivery Unit**, not mixing frontend and backend artifacts from different source revisions.

## Example Dialogue

Developer: "Can I deploy the checkout frontend remote without its server capability?"

Domain expert: "No. Checkout is a MicroVertical, so its composition surfaces belong to one Delivery Unit."

Developer: "Can the checkout Delivery Unit run on different platform surfaces?"

Domain expert: "Yes, if each platform surface preserves the same delivery-unit identity and rejects mixed frontend/backend revisions."

Developer: "Catalog changed its API and my vertical broke. Doesn't Catalog owe me backward compatibility?"

Domain expert: "Not inside the Coordinated Zone. The commit that changed Catalog's surface must also update your consumer — breaking changes are fine there. Only an Externally Published Surface owes anyone stability."

Developer: "The shell needs to show a loyalty-points banner — can I add the points calculation to the shell?"

Domain expert: "No. The shell has no business capability. Loyalty points belong in a vertical; the shell may only compose that vertical's Component Surface, with a Degraded State for when it is absent."
