# RESOLUTION-0001: Surface Discovery Record

- Status: Proposed
- Date: 2026-07-10
- Decision Type: Discovery/resolution contract (W7 of the MicroVertical execution plan)
- Related:
  - `../../CONTEXT.md` (Surface Resolution, Delivery Unit, Degraded State, Rollback)
  - `ADR-0018-backend-federation-contract.md` (incl. Amendment 2026-07-10)
  - `ADR-0019-federated-loading-unified-delivery.md`
  - `ADR-0020-zoned-surface-versioning.md`
  - `packages/toolkit/create/delivery-unit-schema-SPEC.md` (canonical types; contract checkpoint)

## 1. Problem

Discovery is duplicated per platform today: browser MF URLs are generated from
environment/public/local config (`remote-refs.ts`), the Node backend resolves
its own manifest references, and Cloudflare dispatches over service bindings.
Nothing guarantees the locations a consumer ends up using all come from the
same Delivery Unit revision, and rollback must currently repoint each location
kind separately — which ADR-0019 forbids treating as unit rollback.

## 2. Contract

### 2.1 The record

Discovery answers a `SurfaceRef` (grammar in delivery-unit-schema `SPEC.md`)
with exactly one `ResolvedDeliveryUnit` — never a bare URL, never a partial
set of locations:

- `unitId`, `buildMarker`, `sourceRevision`, `baselineCohortId` identify one
  build of one Delivery Unit.
- `surfaces[].locations[]` carry every platform address for that same build:
  `browser-mf-manifest` (mf-manifest.json URL), `node-mf-manifest`
  (backend-mf-manifest.json URL or path), `http-api` (base URL + prefix),
  `cloudflare-service-binding` (binding name + optional dispatch namespace).
- `compatibility` is the resolver's verdict, not the consumer's guess.

**Atomicity invariant (ADR-0019):** the record is the unit of resolution and
of rollback. A resolver returns locations from one `buildMarker` only; a
rollback selects a prior complete record. Mixing location entries from two
records is a resolver defect, structurally unrepresentable in the canonical
type (locations live under one record-level marker).

### 2.2 Providers (the pluggable seam)

`resolve(ref: SurfaceRef, env: EnvironmentId) -> ResolvedDeliveryUnit | DiscoveryError`

- **env/static provider (baseline, always available):** assembles the record
  from environment-configured manifest URLs and generated local overlays —
  today's `createRemoteManifestEnv`/public-URL/localhost fallback chain and
  the Node manifest env become inputs to ONE record instead of two
  independent resolutions. Works offline, no external service.
- **Zephyr provider (optional):** maps `unitId` + environment/tag to a
  snapshot; snapshot metadata supplies all location kinds; pointer flip =
  new record = instant rollback. Zephyr APIs are touched only inside this
  provider.
- **last-known-good cache (Phase 3):** wraps any provider; serves the last
  complete record on provider failure, marked `compatibility: 'degraded'`.

Providers are selected per environment, not per surface — one environment
resolves all surfaces of a unit through the same provider chain.

### 2.3 What execution adapters do (and must not do)

Execution stays platform-specific (ADR-0018 Amendment): browser MF runtime
loads the `browser-mf-manifest` location; the Node MF adapter loads
`node-mf-manifest`; HTTP clients call `http-api`; the Cloudflare shell
dispatches on `cloudflare-service-binding`. Adapters receive a location FROM a
record and must pass the record's `unitId` + `buildMarker` through to identity
validation (existing `microvertical-server-effect-v1` checks). No adapter may
fetch an address from anywhere except a resolved record; hardcoded remote
URLs in consumer code remain forbidden (CONTEXT.md, Surface Resolution).

### 2.4 Failure semantics

`DiscoveryError` is typed: `unknown-unit`, `unknown-surface`,
`major-not-published` (ADR-0020 external majors), `identity-mismatch`,
`stale-record`, `provider-unavailable`. Every consumption point handles these
through its Degraded State obligation; discovery errors are expected states,
not exceptions.

### 2.5 Zones

For `coordinated` units the record carries whatever the environment currently
points at — skew across units during rollout is normal. For `external`
surfaces, the requested `@vN` major participates in resolution: a record is
only compatible when it publishes that major (ADR-0020 side-by-side rule).

## 3. Non-goals

- No new runtime is introduced here; this is the contract Phase 2 (MV-G25)
  implements as the resolver SPI with env/local providers first.
- No global registry requirement for the coordinated zone; the env/static
  provider is sufficient without Zephyr.
- No change to how Cloudflare service bindings are provisioned; only how
  their names are discovered and identity-checked.
