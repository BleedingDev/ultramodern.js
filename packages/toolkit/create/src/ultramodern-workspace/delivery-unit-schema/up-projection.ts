/**
 * Canonical MicroVertical delivery contracts (W4) — v1 UP-projection.
 *
 * This module completes the round-trip that the down-projection in
 * `./types.ts` opened. Where {@link projectDeliveryUnitToV1} maps a canonical
 * {@link DeliveryUnitDescriptor} DOWN onto today's v1 `WorkspaceApp` +
 * `DeliveryUnitRecord`, {@link projectV1ToDeliveryUnit} maps a v1
 * `WorkspaceApp` UP into the canonical descriptor. The two compose so that
 * "every current fixture round-trips v1 -> canonical -> v1" (MicroVertical
 * Phase-1 exit criterion).
 *
 * Like `./types.ts`, this module is intentionally UNWIRED: no generator,
 * normalizer, or runtime path imports it and it changes no emitted output.
 *
 * Binding vocabulary: root `CONTEXT.md`, ADR-0019 (Federated Loading, Unified
 * Delivery), ADR-0020 (Zoned Surface Versioning). See the SPEC §5 mapping
 * table read in reverse.
 *
 * TS constraint: plain types + pure functions only. This file is scanned by
 * `tsgo-boundary.test.ts`; it must never import TypeScript compiler APIs.
 */
import type { Ownership, WorkspaceApi, WorkspaceApp } from '../types';
import type {
  ApiProtocol,
  ApiSurfaceDescriptor,
  BaselineCohort,
  ComponentSurfaceDescriptor,
  DeliveryUnitDescriptor,
  DeliveryUnitKind,
  DeliveryUnitOwner,
  RouteSurfaceDescriptor,
  SurfaceDescriptor,
  SurfaceLocation,
} from './types';

/* -------------------------------------------------------------------------- */
/* Up-projection context                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The identity-root and platform-baseline facts that a v1 `WorkspaceApp` does
 * NOT carry but a canonical {@link DeliveryUnitDescriptor} requires. This is
 * the mirror image of the down-projection's `V1ProjectionContext`: the down
 * context supplies generator-only fields the descriptor deliberately does not
 * own (port, directory, package identity, ownership); this up context supplies
 * the canonical identity root the v1 app never had.
 *
 * Composition contract: given `record = createDeliveryUnitRecord(scope, app)`
 * (or an existing `DeliveryUnitRecord`), thread `record.buildMarker`,
 * `record.sourceRevision`, and the same `scope` through here so the descriptor
 * this produces reconstructs `record.unitId` verbatim. `buildMarker`,
 * `sourceRevision`, and `unitId` therefore survive a v1 -> canonical -> v1
 * pass untouched (SPEC §5 invariant 5, marker preservation).
 */
export type V1UpProjectionContext = {
  /** Package/topology scope. `unitId` = `${scope}/${app.domain ?? app.id}`. */
  scope: string;
  /** Identity root: exact source revision, threaded, never regenerated. */
  sourceRevision: string;
  /** Identity root: exact build marker, threaded, never regenerated. */
  buildMarker: string;
  /**
   * Composition-time platform baseline pins. v1 has no cohort concept (the
   * cohort is advanced platform-wide, never per-vertical), so the caller must
   * supply the resolved cohort this unit was composed against.
   */
  baselineCohort: BaselineCohort;
  /**
   * Protocol for the app's HTTP api surface, if any. Defaults to `rest`:
   * today's v1 `WorkspaceApi` is only ever an HTTP REST prefix, so `rest` is
   * the faithful reading of current reality (SPEC §1: api surfaces carry a
   * protocol; v1 cannot distinguish rpc/graphql).
   */
  apiProtocol?: ApiProtocol;
};

/* -------------------------------------------------------------------------- */
/* Ownership -> owner                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Map a v1 {@link Ownership} block onto the canonical single {@link
 * DeliveryUnitOwner}.
 *
 * Owner honouring (G3): when the v1 `Ownership` carries an explicit `owner`
 * attribution (opt-in — the way v1 records an `agent` / `agent-team` owner),
 * that attribution IS the canonical owner and is passed through verbatim
 * (`kind` + `id` + optional `contact`). Only when no explicit owner was set
 * does this fall back to the neutral human-team default: `kind: 'team'`, `id`
 * from `ownership.team`, `contact` from `ownership.slack`. The down-projection
 * writes a non-team owner back into `ownership.owner`, so agent / agent-team
 * owners round-trip faithfully through the projection pair.
 */
export function ownershipToOwner(ownership: Ownership): DeliveryUnitOwner {
  if (ownership.owner !== undefined) {
    const { kind, id, contact } = ownership.owner;
    return contact === undefined ? { kind, id } : { kind, id, contact };
  }
  return {
    kind: 'team',
    id: ownership.team,
    contact: ownership.slack,
  };
}

/* -------------------------------------------------------------------------- */
/* Kind projection (reverse of SPEC §5)                                        */
/* -------------------------------------------------------------------------- */

/**
 * Map a v1 `WorkspaceApp.kind` up to a canonical {@link DeliveryUnitKind}.
 *
 * `shell` -> `shell`; `vertical` -> `microvertical`. The canonical
 * `horizontal-remote` kind is NEVER produced here: v1 has no way to express a
 * horizontal remote (the down-projection collapses it to `vertical`, so the
 * information is already gone by the time an app exists). See {@link
 * checkV1Representable} for the reverse guard.
 */
function projectKindUp(kind: WorkspaceApp['kind']): DeliveryUnitKind {
  return kind === 'shell' ? 'shell' : 'microvertical';
}

/* -------------------------------------------------------------------------- */
/* Surfaces (reverse of SPEC §5)                                               */
/* -------------------------------------------------------------------------- */

const SEGMENT_UNSAFE = /[^A-Za-z0-9._-]+/g;
const SEGMENT_TRIM = /^-+|-+$/g;

/** Derive a canonical, SurfaceRef-valid `surfaceId` from an MF expose key. */
export function exposeSurfaceId(key: string): string {
  const trimmed = key.replace(/^\.\//, '');
  const cleaned = trimmed
    .replace(SEGMENT_UNSAFE, '-')
    .replace(SEGMENT_TRIM, '');
  return cleaned === '' ? 'surface' : cleaned;
}

/**
 * Map a single v1 expose onto a component-or-route surface.
 *
 * Route heuristic: an expose whose key or local module path mentions `route`
 * is a `route` surface; everything else is a `component`. The exposed local
 * module path (e.g. `./src/...`) is a build detail the canonical model
 * deliberately abstracts away, so it is dropped; the surface's single
 * `browser-mf` location points at the app's MF manifest (derived from
 * `app.port`, the only address a v1 app exposes for its browser bundle).
 */
export function exposeSurface(
  app: WorkspaceApp,
  key: string,
  value: string,
): ComponentSurfaceDescriptor | RouteSurfaceDescriptor {
  const isRoute = /route/i.test(key) || /route/i.test(value);
  const location: SurfaceLocation = {
    platform: 'browser-mf',
    manifestUrl: `http://localhost:${app.port}/mf-manifest.json`,
  };
  const common = {
    surfaceId: exposeSurfaceId(key),
    locations: [location],
  };
  return isRoute
    ? { kind: 'route', ...common }
    : { kind: 'component', ...common };
}

/**
 * Map a v1 `WorkspaceApp.api` onto a canonical `api` surface.
 *
 * `stem` -> `surfaceId`; `prefix` -> a single `http` location `address`;
 * `protocol` from context (default `rest`). `consumedBy` has no canonical
 * home: it is a v1 emergent graph fact (SPEC §5 marks it non-projected), so it
 * is dropped here and the down-projection re-zeroes it to `[]`.
 */
function apiSurface(
  api: WorkspaceApi,
  protocol: ApiProtocol,
): ApiSurfaceDescriptor {
  return {
    kind: 'api',
    surfaceId: api.stem,
    protocol,
    locations: [{ platform: 'http', address: api.prefix }],
  };
}

function projectSurfaces(
  app: WorkspaceApp,
  protocol: ApiProtocol,
): SurfaceDescriptor[] {
  const surfaces: SurfaceDescriptor[] = [];
  for (const [key, value] of Object.entries(app.exposes ?? {})) {
    surfaces.push(exposeSurface(app, key, value));
  }
  if (app.api !== undefined) {
    surfaces.push(apiSurface(app.api, protocol));
  }
  return surfaces;
}

/* -------------------------------------------------------------------------- */
/* Up-projection (v1 -> canonical)                                             */
/* -------------------------------------------------------------------------- */

/**
 * Up-project a v1 `WorkspaceApp` into a canonical {@link
 * DeliveryUnitDescriptor}. Pure and total: `WorkspaceApp.kind` is only
 * `shell | vertical`, so this never throws and never produces the
 * v1-unrepresentable `horizontal-remote` kind or the `external` zone.
 *
 * The `publicationZone` is always `{ zone: 'coordinated' }`: v1 has no way to
 * express external publication (ADR-0020), so a v1 app is always coordinated.
 *
 * Marker preservation: `unitId` = `${context.scope}/${app.domain ?? app.id}`
 * (identical to `createDeliveryUnitRecord`), and `buildMarker` /
 * `sourceRevision` are threaded straight from `context`, never regenerated.
 *
 * NOT wired into any generator path.
 */
export function projectV1ToDeliveryUnit(
  app: WorkspaceApp,
  context: V1UpProjectionContext,
): DeliveryUnitDescriptor {
  const protocol = context.apiProtocol ?? 'rest';
  return {
    unitId: `${context.scope}/${app.domain ?? app.id}`,
    kind: projectKindUp(app.kind),
    owner: ownershipToOwner(app.ownership),
    sourceRevision: context.sourceRevision,
    buildMarker: context.buildMarker,
    baselineCohort: context.baselineCohort,
    publicationZone: { zone: 'coordinated' },
    surfaces: projectSurfaces(app, protocol),
  };
}

/* -------------------------------------------------------------------------- */
/* v1 representability guard (canonical -> v1 direction)                       */
/* -------------------------------------------------------------------------- */

/**
 * The reasons a canonical descriptor cannot be faithfully represented in v1.
 * The down-projection in `./types.ts` degrades ALL of these silently, so this
 * guard exhaustively detects every canonical construct the v1 shape cannot
 * carry and lets callers fail loudly INSTEAD of degrading silently:
 *
 * - `horizontal-remote-kind`: v1 collapses `horizontal-remote` to `vertical`.
 * - `external-zone`: v1 has no publication-zone field (ADR-0020).
 * - `non-team-owner`: v1 `Ownership` always names a human team; `agent` /
 *   `agent-team` owners have no v1 home (the up-projection always emits
 *   `team`).
 * - `component-or-route-surface`: the down-projection reconstructs no
 *   `exposes`, so every component/route surface is dropped.
 * - `backend-surface`: v1 has no backend-surface vocabulary at all.
 * - `multiple-api-surfaces`: v1 carries at most ONE `WorkspaceApi`; the
 *   down-projection keeps the first api surface and drops the rest.
 * - `non-rest-protocol`: v1 `WorkspaceApi` is an HTTP REST prefix; `rpc` /
 *   `graphql` protocols are dropped (the up-projection re-defaults to
 *   `rest`).
 * - `unsupported-surface-shape`: an api surface whose shape v1 cannot carry —
 *   anything other than exactly one `http` location, or per-surface
 *   `externallyPublished` / `unknownFields` metadata.
 * - `unknown-fields`: the descriptor carries top-level `unknownFields`. v1 has
 *   nowhere to store them in-band — the down-projection returns them
 *   out-of-band (`preservedUnknownFields`), so a v1 shape cannot reproduce the
 *   descriptor byte-for-byte in a single canonical value.
 * - `non-canonical-zone`: the descriptor's `publicationZone` is not exactly the
 *   canonical `{ zone: 'coordinated' }` the up-projection always re-emits. A
 *   descriptor with NO `publicationZone` (down drops the field, up re-adds an
 *   explicit coordinated zone) or a `coordinated` zone carrying extra fields is
 *   therefore not round-trip-faithful.
 */
export type V1UnrepresentableReason =
  | 'horizontal-remote-kind'
  | 'external-zone'
  | 'non-team-owner'
  | 'component-or-route-surface'
  | 'backend-surface'
  | 'multiple-api-surfaces'
  | 'non-rest-protocol'
  | 'unsupported-surface-shape'
  | 'unknown-fields'
  | 'non-canonical-zone';

export type V1RepresentabilityResult =
  | { representable: true }
  | {
      representable: false;
      code: 'unrepresentable-in-v1';
      reason: V1UnrepresentableReason;
    };

/**
 * A typed error for v1-unrepresentable cases. `code` is always
 * `'unrepresentable-in-v1'`; `reason` narrows which invariant was violated.
 */
export class V1UnrepresentableError extends Error {
  readonly code = 'unrepresentable-in-v1' as const;
  readonly reason: V1UnrepresentableReason;

  constructor(reason: V1UnrepresentableReason) {
    super(`Descriptor unrepresentable in v1: ${reason}.`);
    this.name = 'V1UnrepresentableError';
    this.reason = reason;
  }
}

/** First unrepresentable construct within one surface, if any. */
function checkSurfaceRepresentable(
  surface: SurfaceDescriptor,
): V1UnrepresentableReason | undefined {
  if (surface.kind === 'component' || surface.kind === 'route') {
    return 'component-or-route-surface';
  }
  if (surface.kind === 'backend') {
    return 'backend-surface';
  }
  // api surface.
  if (surface.protocol !== 'rest') {
    return 'non-rest-protocol';
  }
  const [first, ...rest] = surface.locations;
  if (first === undefined || rest.length > 0 || first.platform !== 'http') {
    return 'unsupported-surface-shape';
  }
  if (
    surface.externallyPublished !== undefined ||
    surface.unknownFields !== undefined
  ) {
    return 'unsupported-surface-shape';
  }
  return undefined;
}

/**
 * Total check: is a canonical descriptor faithfully representable in v1?
 * Returns a typed result rather than throwing. Exhaustive over the loss set
 * of `projectDeliveryUnitToV1` (see {@link V1UnrepresentableReason}); the
 * first detected reason is reported, in a deterministic order (unit-level
 * kind, unknown-fields, zone, owner first, then surfaces in declaration
 * order).
 *
 * The round-trip law rests on this guard: for descriptors this function
 * accepts, canonical -> v1 -> canonical is lossless on every
 * representability-covered field.
 */
export function checkV1Representable(
  descriptor: DeliveryUnitDescriptor,
): V1RepresentabilityResult {
  const unrepresentable = (
    reason: V1UnrepresentableReason,
  ): V1RepresentabilityResult => ({
    representable: false,
    code: 'unrepresentable-in-v1',
    reason,
  });

  if (descriptor.kind === 'horizontal-remote') {
    return unrepresentable('horizontal-remote-kind');
  }
  if (descriptor.unknownFields !== undefined) {
    return unrepresentable('unknown-fields');
  }
  const zone = descriptor.publicationZone;
  if (zone === undefined) {
    return unrepresentable('non-canonical-zone');
  }
  if (zone.zone === 'external') {
    return unrepresentable('external-zone');
  }
  if (zone.zone !== 'coordinated' || Object.keys(zone).length !== 1) {
    return unrepresentable('non-canonical-zone');
  }
  if (descriptor.owner.kind !== 'team') {
    return unrepresentable('non-team-owner');
  }

  let apiSurfaceCount = 0;
  for (const surface of descriptor.surfaces) {
    if (surface.kind === 'api') {
      apiSurfaceCount += 1;
      if (apiSurfaceCount > 1) {
        return unrepresentable('multiple-api-surfaces');
      }
    }
    const reason = checkSurfaceRepresentable(surface);
    if (reason !== undefined) {
      return unrepresentable(reason);
    }
  }

  return { representable: true };
}

/**
 * Assert v1 representability, throwing a typed {@link V1UnrepresentableError}
 * for any descriptor carrying a construct the v1 shape cannot represent,
 * rather than letting the down-projection degrade it silently.
 */
export function assertV1Representable(
  descriptor: DeliveryUnitDescriptor,
): void {
  const result = checkV1Representable(descriptor);
  if (!result.representable) {
    throw new V1UnrepresentableError(result.reason);
  }
}
