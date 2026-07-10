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
 * Kind heuristic: v1 ownership always names a human on-call team (a Slack
 * channel + PagerDuty rotation), so this always yields `kind: 'team'`. v1
 * cannot express `agent` / `agent-team` ownership; those canonical owner kinds
 * are simply unreachable from a v1 app (they only appear on descriptors
 * authored canonically). `id` comes from `ownership.team`; `contact` from
 * `ownership.slack`.
 */
export function ownershipToOwner(ownership: Ownership): DeliveryUnitOwner {
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
function exposeSurfaceId(key: string): string {
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
function exposeSurface(
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
 * The down-projection in `./types.ts` degrades both cases silently
 * (`horizontal-remote` collapses to `vertical`; an `external` zone is dropped
 * because v1 has no zone field). This guard lets callers detect the loss and
 * fail loudly INSTEAD of degrading silently.
 */
export type V1UnrepresentableReason =
  | 'horizontal-remote-kind'
  | 'external-zone';

export type V1RepresentabilityResult =
  | { representable: true }
  | {
      representable: false;
      code: 'unrepresentable-in-v1';
      reason: V1UnrepresentableReason;
    };

/**
 * A typed error for the v1-unrepresentable cases. `code` is always
 * `'unrepresentable-in-v1'`; `reason` narrows which invariant was violated.
 */
export class V1UnrepresentableError extends Error {
  readonly code = 'unrepresentable-in-v1' as const;
  readonly reason: V1UnrepresentableReason;

  constructor(reason: V1UnrepresentableReason) {
    super(`Descriptor is unrepresentable in v1: ${reason}.`);
    this.name = 'V1UnrepresentableError';
    this.reason = reason;
  }
}

/**
 * Total check: is this canonical descriptor faithfully representable in v1?
 * Returns a typed result rather than throwing. A `horizontal-remote` kind or
 * an `external` publication zone is unrepresentable; everything else is fine.
 */
export function checkV1Representable(
  descriptor: DeliveryUnitDescriptor,
): V1RepresentabilityResult {
  if (descriptor.kind === 'horizontal-remote') {
    return {
      representable: false,
      code: 'unrepresentable-in-v1',
      reason: 'horizontal-remote-kind',
    };
  }
  if (descriptor.publicationZone?.zone === 'external') {
    return {
      representable: false,
      code: 'unrepresentable-in-v1',
      reason: 'external-zone',
    };
  }
  return { representable: true };
}

/**
 * Assert v1 representability, throwing a typed {@link V1UnrepresentableError}
 * for `horizontal-remote` / `external` descriptors rather than letting the
 * down-projection degrade them silently.
 */
export function assertV1Representable(
  descriptor: DeliveryUnitDescriptor,
): void {
  const result = checkV1Representable(descriptor);
  if (!result.representable) {
    throw new V1UnrepresentableError(result.reason);
  }
}
