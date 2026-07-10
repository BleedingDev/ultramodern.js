# Delivery-Unit Schema (canonical contracts) — SPEC

Status: **defined, unwired** (MicroVertical plan task W4). Nothing in the
generator, normalizer, or runtime imports these types; no emitted output
changes. The v1 down-projection is a pure, tested function that no generation
path calls.

Binding vocabulary: root [`CONTEXT.md`](../../../../../../CONTEXT.md),
[ADR-0019](../../../../../../docs/super-app-rfc-adr/ADR-0019-federated-loading-unified-delivery.md)
(Federated Loading, Unified Delivery),
[ADR-0020](../../../../../../docs/super-app-rfc-adr/ADR-0020-zoned-surface-versioning.md)
(Zoned Surface Versioning).

Contracts live in [`types.ts`](./types.ts). Tests:
[`../../../tests/delivery-unit-schema.test.ts`](../../../tests/delivery-unit-schema.test.ts).

## 1. Shapes

- `DeliveryUnitDescriptor` — canonical authoring shape for one indivisible
  delivery unit: `unitId`, `kind` (`microvertical | shell | horizontal-remote`),
  single `owner`, identity root (`sourceRevision`, `buildMarker`),
  `baselineCohort` (opaque `cohortId` + resolved React/TanStack Router/Effect/
  Tailwind pins), optional `publicationZone`, and `surfaces[]`.
- `SurfaceDescriptor` — discriminated on `kind`: `component | route | api |
  backend`. `api` additionally carries `protocol: rest | rpc | graphql`. Every
  surface has a `surfaceId`, per-platform `locations[]`, and an optional
  `externallyPublished` marker that inherits the unit's zone.
- `SurfaceLocation` — discriminated on `platform`: `browser-mf` /`node-mf`
  (each `manifestUrl`), `http` (`address`), `cloudflare-binding`
  (`serviceBinding`). One surface may resolve on several platforms under one
  delivery identity (ADR-0019 §2-3; plan-review §3.2 item 7).
- `SurfaceRef` — canonical string grammar + `ParsedSurfaceRef` object form
  (§2), with total `parseSurfaceRef` / `formatSurfaceRef`.
- `ResolvedDeliveryUnit` — atomic resolution result (§3).

## 2. SurfaceRef grammar (EBNF)

```ebnf
SurfaceRef   = UnitId , "#" , SurfaceId , [ "@" , Major ] ;
UnitId       = Segment , { "/" , Segment } ;
SurfaceId    = Segment ;
Segment      = SegmentChar , { SegmentChar } ;
SegmentChar  = letter | digit | "-" | "_" | "." ;
Major        = "v" , nonzero , { digit } ;
letter       = "A" | … | "Z" | "a" | … | "z" ;
digit        = "0" | "1" | … | "9" ;
nonzero      = "1" | "2" | … | "9" ;
```

Canonical form: `unitId#surfaceId` with optional `@vN` external-major suffix
(e.g. `acme/checkout#cart`, `acme/checkout#cart@v2`).

- `UnitId` allows `/` (scope/name, matching v1 `${scope}/${id}`); each segment
  is non-empty and drawn from `SegmentChar`.
- `SurfaceId` is a single `Segment` (no `/`).
- `Major` is `v` + a positive integer with no leading zero. Absent major means
  "the coordinated-zone surface"; a present major selects an externally
  published major (ADR-0020).

`parseSurfaceRef` is total (never throws) and returns one of these typed
errors, exhaustively: `empty`, `missing-surface-separator`,
`multiple-surface-separators`, `empty-unit-id`, `invalid-unit-id` (+`segment`),
`empty-surface-id`, `invalid-surface-id`, `empty-major`, `invalid-major`
(+`value`). Round-trip: `formatSurfaceRef(parse(x).ref) === x` for every valid
`x`.

## 3. `ResolvedDeliveryUnit` — atomic resolution

Resolution is all-or-nothing. Every platform location for the unit resolves
together against **one** `buildMarker` / `sourceRevision`. The shape encodes
the ADR-0019 constraint that a resolver may never mix locations from different
build markers:

- The `buildMarker`, `sourceRevision`, and `baselineCohortId` live **once**, on
  `ResolvedDeliveryUnit`.
- `ResolvedSurface` carries `locations[]` but **no** marker of its own, so
  there is structurally no way to attach a location from a different marker.
- There is no partial variant. A resolver returns a whole
  `ResolvedDeliveryUnit` (with a `CompatibilityVerdict`) or a typed failure.

This shape and the SurfaceRef grammar (§2) are the **contract checkpoint** for
W5 (observed-graph) and W7 (discovery record).

## 4. Invariants

1. **One owner per unit.** `DeliveryUnitDescriptor.owner` is a single record
   (CONTEXT.md: a MicroVertical never has more than one owner).
2. **One identity root.** All surfaces derive from the unit's single
   `sourceRevision` + `buildMarker` (ADR-0019 invariants 1-2); surface-level
   markers are defense in depth, not a second source of truth.
3. **Atomic resolution.** See §3 — never a per-surface mix of markers.
4. **Zone default.** A unit with no `publicationZone` is `coordinated`
   (`resolvePublicationZone`). `external` structurally requires an
   `ExternalPublication` record (ADR-0020).
5. **Marker preservation on schema-only migration.** Down-projection (§5) and
   any schema-only migration pass `buildMarker` / `sourceRevision` / `unitId`
   through unchanged; markers rotate only on a declared new build, never as a
   side effect of re-serialization.
6. **Unknown-field preservation.** `parseDeliveryUnitDescriptor` captures
   unrecognised top-level and per-surface keys into `unknownFields`;
   `serializeDeliveryUnitDescriptor` spreads them back at their original level
   (known keys win on collision). Round-trip is lossless:
   `serialize(parse(json))` deep-equals `json`.

## 5. v1 down-projection

`projectDeliveryUnitToV1(descriptor, context) => { app, deliveryUnitRecord,
preservedUnknownFields }` is pure and total. Sources: `descriptor.*` from the
canonical shape; `context.*` for generator-only fields the descriptor
deliberately does not own (port, directory, package identity, ownership).

| v1 target                       | source                                            | notes |
|---------------------------------|---------------------------------------------------|-------|
| `WorkspaceApp.id`               | last `/` segment of `descriptor.unitId`           | |
| `WorkspaceApp.kind`             | `microvertical`/`horizontal-remote` → `vertical`; `shell` → `shell` | lossy: v1 has no `horizontal-remote` |
| `WorkspaceApp.api`              | first `kind: 'api'` surface → `{ stem: surfaceId, prefix: http address ?? '/'+surfaceId, consumedBy: [] }` | omitted if no api surface |
| `WorkspaceApp.directory/packageSuffix/displayName/portEnv/port/mfName/ownership` | `context.*` | not owned by descriptor |
| `WorkspaceApp.exposes/verticalRefs/domain` | — | not projected (emergent/underivable) |
| `DeliveryUnitRecord.appId`      | last `/` segment of `descriptor.unitId`           | |
| `DeliveryUnitRecord.unitId`     | `descriptor.unitId`                               | **preserved** |
| `DeliveryUnitRecord.buildMarker`| `descriptor.buildMarker`                          | **preserved** (invariant 5) |
| `DeliveryUnitRecord.sourceRevision` | `descriptor.sourceRevision`                   | **preserved** |
| `DeliveryUnitRecord.kind`       | `DELIVERY_UNIT_KIND` constant                     | v1 single-kind literal |
| `DeliveryUnitRecord.schemaVersion` | `DELIVERY_UNIT_SCHEMA_VERSION` constant        | |
| `DeliveryUnitRecord.deployProfile` | `DELIVERY_UNIT_DEPLOY_PROFILE` constant        | |
| `DeliveryUnitRecord.packageName/version` | `context.*`                              | not owned by descriptor |
| `preservedUnknownFields`        | `descriptor.unknownFields ?? {}`                  | forward-compat carry-through |

Lossy fields (`kind` collapse, dropped `exposes`/`verticalRefs`, generator-only
context fields) are why v1 is a *down*-projection: the canonical descriptor is a
strict superset of the v1 `WorkspaceApp`.
