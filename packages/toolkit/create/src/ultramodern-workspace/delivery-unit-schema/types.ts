/**
 * Canonical MicroVertical delivery contracts (W4).
 *
 * This module DEFINES the canonical shapes only. It is intentionally UNWIRED:
 * no generator, normalizer, or runtime path imports it, and it does not change
 * any emitted output. The v1 down-projection here is a pure, tested function;
 * it is not invoked by any generation path.
 *
 * Binding vocabulary: root `CONTEXT.md`, ADR-0019 (Federated Loading, Unified
 * Delivery), ADR-0020 (Zoned Surface Versioning). See `packages/toolkit/create/delivery-unit-schema-SPEC.md` for the
 * SurfaceRef grammar, invariants, and the v1 mapping table.
 *
 * TS constraint: plain types + pure functions only. This file is scanned by
 * `tsgo-boundary.test.ts`; it must never import TypeScript compiler APIs.
 */
import {
  DELIVERY_UNIT_DEPLOY_PROFILE,
  DELIVERY_UNIT_KIND,
  DELIVERY_UNIT_SCHEMA_VERSION,
  type DeliveryUnitRecord,
} from '@modern-js/utils/universal';
import type {
  JsonObject,
  JsonValue,
  Ownership,
  WorkspaceApi,
  WorkspaceApp,
} from '../types';

/* -------------------------------------------------------------------------- */
/* Owner                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The single accountable owner of a delivery unit. Exactly one owner per unit
 * (CONTEXT.md: "MicroVertical never [has more than] one owner").
 */
export type DeliveryUnitOwner = {
  kind: 'team' | 'agent' | 'agent-team';
  id: string;
  contact?: string;
};

/* -------------------------------------------------------------------------- */
/* Baseline cohort                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Exact platform-baseline pins resolved for this unit. Composition-time
 * singletons only (CONTEXT.md: Platform Baseline). Verticals never pick their
 * own version; the cohort is advanced platform-wide.
 */
export type BaselineCohortResolved = {
  react: string;
  tanstackRouter: string;
  effect: string;
  tailwind: string;
};

/**
 * A baseline cohort is an opaque, stable id plus the exact record it resolves
 * to. The id is the unit of comparison; the resolved record is the evidence.
 */
export type BaselineCohort = {
  cohortId: string;
  resolved: BaselineCohortResolved;
};

/* -------------------------------------------------------------------------- */
/* Publication zone (ADR-0020)                                                 */
/* -------------------------------------------------------------------------- */

export type ExternalRetirement = {
  /** SurfaceRef (canonical string) of the successor major, when known. */
  supersededBy?: string;
  /** Opaque retirement marker (window id / date string), owner-defined. */
  sunsetAfter?: string;
};

/**
 * External-publication terms. A breaking change ships as a new major exposed
 * side by side with the previous major until known consumers migrate.
 */
export type ExternalPublication = {
  surfaceMajor: number;
  /** Opaque compatible-baseline descriptor (e.g. a cohort range id). */
  baselineCompatibility: string;
  retirement?: ExternalRetirement;
};

/**
 * Zone discriminated union. `external` carries its terms atomically: it is a
 * type error to be in the external zone without an {@link ExternalPublication}
 * record. Default is `coordinated` (see {@link resolvePublicationZone}).
 */
export type PublicationZone =
  | { zone: 'coordinated' }
  | { zone: 'external'; external: ExternalPublication };

/* -------------------------------------------------------------------------- */
/* Surface platform locations                                                  */
/* -------------------------------------------------------------------------- */

export type SurfaceLocationPlatform =
  | 'browser-mf'
  | 'node-mf'
  | 'http'
  | 'cloudflare-binding';

/**
 * A concrete per-platform location for a surface. Discriminated on `platform`
 * so each platform carries only the address shape it can actually resolve.
 * (ADR-0019 §3: UI/API/backend addresses are derived, platform-appropriate.)
 */
export type SurfaceLocation =
  | { platform: 'browser-mf'; manifestUrl: string }
  | { platform: 'node-mf'; manifestUrl: string }
  | { platform: 'http'; address: string }
  | { platform: 'cloudflare-binding'; serviceBinding: string };

/* -------------------------------------------------------------------------- */
/* Surface descriptor (discriminated union)                                    */
/* -------------------------------------------------------------------------- */

export type SurfaceKind = 'component' | 'route' | 'api' | 'backend';
export type ApiProtocol = 'rest' | 'rpc' | 'graphql';

type SurfaceCommon = {
  surfaceId: string;
  /** Per-platform locations. Never mixed across delivery-unit build markers. */
  locations: SurfaceLocation[];
  /**
   * Marks a surface as externally consumable. It inherits the unit's zone:
   * only meaningful when the unit's {@link PublicationZone} is `external`.
   */
  externallyPublished?: boolean;
  /** Unknown/forward-compatible fields preserved verbatim on round-trip. */
  unknownFields?: JsonObject;
};

export type ComponentSurfaceDescriptor = SurfaceCommon & { kind: 'component' };
export type RouteSurfaceDescriptor = SurfaceCommon & { kind: 'route' };
export type ApiSurfaceDescriptor = SurfaceCommon & {
  kind: 'api';
  protocol: ApiProtocol;
};
export type BackendSurfaceDescriptor = SurfaceCommon & { kind: 'backend' };

export type SurfaceDescriptor =
  | ComponentSurfaceDescriptor
  | RouteSurfaceDescriptor
  | ApiSurfaceDescriptor
  | BackendSurfaceDescriptor;

/* -------------------------------------------------------------------------- */
/* Delivery unit descriptor                                                    */
/* -------------------------------------------------------------------------- */

export type DeliveryUnitKind = 'microvertical' | 'shell' | 'horizontal-remote';

/**
 * The canonical authoring shape for one indivisible delivery unit. All surfaces
 * derive from the single `sourceRevision` / `buildMarker` identity root
 * (ADR-0019 invariants 1-2). This is a superset of today's v1 `WorkspaceApp`;
 * see {@link projectDeliveryUnitToV1} for the lossy down-projection.
 */
export type DeliveryUnitDescriptor = {
  unitId: string;
  kind: DeliveryUnitKind;
  owner: DeliveryUnitOwner;
  sourceRevision: string;
  buildMarker: string;
  baselineCohort: BaselineCohort;
  /** Defaults to `{ zone: 'coordinated' }` when omitted. */
  publicationZone?: PublicationZone;
  surfaces: SurfaceDescriptor[];
  /** Unknown/forward-compatible fields preserved verbatim on round-trip. */
  unknownFields?: JsonObject;
};

/* -------------------------------------------------------------------------- */
/* Resolved delivery unit (atomic resolution result)                           */
/* -------------------------------------------------------------------------- */

/**
 * A resolved surface. It carries NO build marker of its own: the marker lives
 * once on the {@link ResolvedDeliveryUnit}, so a resolver structurally cannot
 * mix locations from different markers (ADR-0019 §3, invariant 3).
 */
export type ResolvedSurface = {
  surfaceId: string;
  kind: SurfaceKind;
  locations: SurfaceLocation[];
};

export type CompatibilityStatus = 'compatible' | 'incompatible' | 'degraded';

export type CompatibilityVerdict = {
  status: CompatibilityStatus;
  /** Baseline cohort id the verdict was computed against. */
  baselineCohortId: string;
  reason?: string;
};

/**
 * Atomic resolution result. Every platform location for the unit is resolved
 * together against ONE `buildMarker` / `sourceRevision`. There is no partial
 * shape: a resolver returns a whole {@link ResolvedDeliveryUnit} or a typed
 * failure — never a per-surface mix of markers. This shape is the W5/W7
 * contract checkpoint.
 */
export type ResolvedDeliveryUnit = {
  unitId: string;
  buildMarker: string;
  sourceRevision: string;
  baselineCohortId: string;
  surfaces: ResolvedSurface[];
  compatibility: CompatibilityVerdict;
};

/* -------------------------------------------------------------------------- */
/* SurfaceRef grammar                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Parsed form of a SurfaceRef. Canonical string form is `unitId#surfaceId`
 * with an optional `@vN` major suffix. See `packages/toolkit/create/delivery-unit-schema-SPEC.md` for the EBNF.
 */
export type ParsedSurfaceRef = {
  unitId: string;
  surfaceId: string;
  /** External-major selector. Absent means "the coordinated-zone surface". */
  major?: number;
};

export type SurfaceRefParseError =
  | { code: 'empty' }
  | { code: 'missing-surface-separator' }
  | { code: 'multiple-surface-separators' }
  | { code: 'empty-unit-id' }
  | { code: 'invalid-unit-id'; segment: string }
  | { code: 'empty-surface-id' }
  | { code: 'invalid-surface-id' }
  | { code: 'empty-major' }
  | { code: 'invalid-major'; value: string };

export type SurfaceRefParseResult =
  | { ok: true; ref: ParsedSurfaceRef }
  | { ok: false; error: SurfaceRefParseError };

const SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;
const MAJOR_PATTERN = /^v[1-9][0-9]*$/;

/**
 * Parse a canonical SurfaceRef string. Total function: every rejection is a
 * typed {@link SurfaceRefParseError}; never throws.
 */
export function parseSurfaceRef(input: string): SurfaceRefParseResult {
  if (input === '') {
    return { ok: false, error: { code: 'empty' } };
  }

  const hashCount = countChar(input, '#');
  if (hashCount === 0) {
    return { ok: false, error: { code: 'missing-surface-separator' } };
  }
  if (hashCount > 1) {
    return { ok: false, error: { code: 'multiple-surface-separators' } };
  }

  const hashIndex = input.indexOf('#');
  const unitPart = input.slice(0, hashIndex);
  const rest = input.slice(hashIndex + 1);

  const atIndex = rest.indexOf('@');
  const surfaceId = atIndex === -1 ? rest : rest.slice(0, atIndex);
  const ref: ParsedSurfaceRef = { unitId: unitPart, surfaceId };

  if (atIndex !== -1) {
    const majorPart = rest.slice(atIndex + 1);
    if (majorPart === '') {
      return { ok: false, error: { code: 'empty-major' } };
    }
    if (!MAJOR_PATTERN.test(majorPart)) {
      return { ok: false, error: { code: 'invalid-major', value: majorPart } };
    }
    ref.major = Number(majorPart.slice(1));
  }

  const error = validateSurfaceRef(ref);
  return error === undefined ? { ok: true, ref } : { ok: false, error };
}

/**
 * Render a {@link ParsedSurfaceRef} back to its canonical string form.
 *
 * Direct inputs are checked against the same invariant as parsed references,
 * so this formatter cannot emit a string that {@link parseSurfaceRef} rejects.
 */
export function formatSurfaceRef(ref: ParsedSurfaceRef): string {
  const error = validateSurfaceRef(ref);
  if (error !== undefined) {
    throw new TypeError(`Cannot format invalid SurfaceRef: ${error.code}.`);
  }

  const base = `${ref.unitId}#${ref.surfaceId}`;
  return ref.major === undefined ? base : `${base}@v${ref.major}`;
}

/** The shared semantic invariant for parsed and directly formatted references. */
function validateSurfaceRef(
  ref: ParsedSurfaceRef,
): SurfaceRefParseError | undefined {
  if (ref.unitId === '') {
    return { code: 'empty-unit-id' };
  }
  for (const segment of ref.unitId.split('/')) {
    if (!SEGMENT_PATTERN.test(segment)) {
      return { code: 'invalid-unit-id', segment };
    }
  }

  if (ref.surfaceId === '') {
    return { code: 'empty-surface-id' };
  }
  if (!SEGMENT_PATTERN.test(ref.surfaceId)) {
    return { code: 'invalid-surface-id' };
  }

  if (
    ref.major !== undefined &&
    (!Number.isSafeInteger(ref.major) || ref.major < 1)
  ) {
    return { code: 'invalid-major', value: String(ref.major) };
  }

  return undefined;
}

function countChar(input: string, char: string): number {
  let count = 0;
  for (const current of input) {
    if (current === char) {
      count += 1;
    }
  }
  return count;
}

/* -------------------------------------------------------------------------- */
/* Zone defaulting                                                             */
/* -------------------------------------------------------------------------- */

/** Apply the zone default (coordinated) invariant. */
export function resolvePublicationZone(
  zone: PublicationZone | undefined,
): PublicationZone {
  return zone ?? { zone: 'coordinated' };
}

/* -------------------------------------------------------------------------- */
/* Unknown-field preservation (round-trip parse -> serialize)                  */
/* -------------------------------------------------------------------------- */

const KNOWN_DESCRIPTOR_KEYS = new Set([
  'unitId',
  'kind',
  'owner',
  'sourceRevision',
  'buildMarker',
  'baselineCohort',
  'publicationZone',
  'surfaces',
]);

const KNOWN_SURFACE_KEYS = new Set([
  'kind',
  'surfaceId',
  'locations',
  'protocol',
  'externallyPublished',
]);

function splitUnknown(
  source: JsonObject,
  known: Set<string>,
): JsonObject | undefined {
  const unknown: JsonObject = {};
  let hasUnknown = false;
  for (const [key, value] of Object.entries(source)) {
    if (!known.has(key)) {
      unknown[key] = value;
      hasUnknown = true;
    }
  }
  return hasUnknown ? unknown : undefined;
}

/**
 * Parse a JSON object into a {@link DeliveryUnitDescriptor}, capturing any
 * unrecognised top-level and per-surface keys into `unknownFields` so a later
 * {@link serializeDeliveryUnitDescriptor} can round-trip them verbatim.
 *
 * This is contract-shape capture, not strict validation (that is W3's job);
 * known fields are trusted to already have their declared shapes.
 */
export function parseDeliveryUnitDescriptor(
  source: JsonObject,
): DeliveryUnitDescriptor {
  const rawSurfaces = Array.isArray(source.surfaces) ? source.surfaces : [];
  const surfaces = rawSurfaces.map(entry => {
    const surface = entry as unknown as SurfaceDescriptor;
    const unknown = splitUnknown(entry as JsonObject, KNOWN_SURFACE_KEYS);
    return unknown === undefined
      ? surface
      : ({ ...surface, unknownFields: unknown } as SurfaceDescriptor);
  });

  const descriptor: DeliveryUnitDescriptor = {
    unitId: source.unitId as string,
    kind: source.kind as DeliveryUnitKind,
    owner: source.owner as unknown as DeliveryUnitOwner,
    sourceRevision: source.sourceRevision as string,
    buildMarker: source.buildMarker as string,
    baselineCohort: source.baselineCohort as unknown as BaselineCohort,
    surfaces,
  };

  if (source.publicationZone !== undefined) {
    descriptor.publicationZone =
      source.publicationZone as unknown as PublicationZone;
  }

  const unknown = splitUnknown(source, KNOWN_DESCRIPTOR_KEYS);
  if (unknown !== undefined) {
    descriptor.unknownFields = unknown;
  }

  return descriptor;
}

/**
 * Serialize a {@link DeliveryUnitDescriptor} back to a JSON object. Preserved
 * `unknownFields` are spread back at their original level; known keys always
 * win over a colliding unknown key.
 */
export function serializeDeliveryUnitDescriptor(
  descriptor: DeliveryUnitDescriptor,
): JsonObject {
  const surfaces = descriptor.surfaces.map(surface => {
    const { unknownFields, ...known } = surface;
    return { ...(unknownFields ?? {}), ...known } as unknown as JsonValue;
  });

  const { unknownFields, surfaces: _surfaces, ...knownRest } = descriptor;
  const output: JsonObject = {
    ...(unknownFields ?? {}),
    ...(knownRest as unknown as JsonObject),
    surfaces,
  };
  return output;
}

/* -------------------------------------------------------------------------- */
/* v1 down-projection                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Generator-only fields that have no source in the canonical descriptor (port
 * assignment, directory layout, package identity, ownership metadata). The
 * descriptor deliberately does not own these; the v1 projection needs them to
 * reconstruct today's `WorkspaceApp` / `DeliveryUnitRecord`.
 */
export type V1ProjectionContext = {
  directory: string;
  packageSuffix: string;
  displayName: string;
  portEnv: string;
  port: number;
  mfName: string;
  ownership: Ownership;
  packageName: string;
  version: string;
};

export type DeliveryUnitV1Projection = {
  app: WorkspaceApp;
  deliveryUnitRecord: DeliveryUnitRecord;
  /** Unknown descriptor-level fields, preserved for lossless re-serialization. */
  preservedUnknownFields: JsonObject;
};

function projectKind(kind: DeliveryUnitKind): WorkspaceApp['kind'] {
  switch (kind) {
    case 'shell':
      return 'shell';
    case 'microvertical':
    case 'horizontal-remote':
      // v1 has no 'horizontal-remote'; it collapses to 'vertical' (lossy).
      return 'vertical';
    default:
      return assertNever(kind);
  }
}

function lastSegment(unitId: string): string {
  const segments = unitId.split('/');
  return segments[segments.length - 1] ?? unitId;
}

function projectApi(surfaces: SurfaceDescriptor[]): WorkspaceApi | undefined {
  const apiSurface = surfaces.find(
    (surface): surface is ApiSurfaceDescriptor => surface.kind === 'api',
  );
  if (apiSurface === undefined) {
    return undefined;
  }
  const http = apiSurface.locations.find(
    (location): location is Extract<SurfaceLocation, { platform: 'http' }> =>
      location.platform === 'http',
  );
  return {
    stem: apiSurface.surfaceId,
    prefix: http?.address ?? `/${apiSurface.surfaceId}`,
    consumedBy: [],
  };
}

/**
 * Down-project a canonical {@link DeliveryUnitDescriptor} onto today's v1
 * `WorkspaceApp` + `DeliveryUnitRecord` shapes. Pure and total.
 *
 * Invariant (schema-only migration preserves markers): `buildMarker`,
 * `sourceRevision`, and `unitId` flow straight through from the descriptor and
 * are never regenerated here. See `packages/toolkit/create/delivery-unit-schema-SPEC.md` for the field-by-field table.
 *
 * NOT wired into any generator path.
 */
export function projectDeliveryUnitToV1(
  descriptor: DeliveryUnitDescriptor,
  context: V1ProjectionContext,
): DeliveryUnitV1Projection {
  const appId = lastSegment(descriptor.unitId);
  const api = projectApi(descriptor.surfaces);

  // Owner round-trip (G3): a `team` owner is v1-native (its id/contact live in
  // `ownership.team`/`ownership.slack`), so the neutral context ownership is
  // left byte-identical. A non-team (`agent` / `agent-team`) owner has no
  // v1-native home, so it is carried back explicitly in `ownership.owner`,
  // where the up-projection reads it again — faithful through the pair.
  const ownership: Ownership =
    descriptor.owner.kind === 'team'
      ? context.ownership
      : { ...context.ownership, owner: { ...descriptor.owner } };

  const app: WorkspaceApp = {
    id: appId,
    directory: context.directory,
    packageSuffix: context.packageSuffix,
    displayName: context.displayName,
    kind: projectKind(descriptor.kind),
    portEnv: context.portEnv,
    port: context.port,
    mfName: context.mfName,
    ownership,
    ...(api === undefined ? {} : { api }),
  };

  const deliveryUnitRecord: DeliveryUnitRecord = {
    appId,
    buildMarker: descriptor.buildMarker,
    deployProfile: DELIVERY_UNIT_DEPLOY_PROFILE,
    kind: DELIVERY_UNIT_KIND,
    packageName: context.packageName,
    schemaVersion: DELIVERY_UNIT_SCHEMA_VERSION,
    sourceRevision: descriptor.sourceRevision,
    unitId: descriptor.unitId,
    version: context.version,
  };

  return {
    app,
    deliveryUnitRecord,
    preservedUnknownFields: descriptor.unknownFields ?? {},
  };
}

/* -------------------------------------------------------------------------- */
/* Exhaustiveness helper                                                       */
/* -------------------------------------------------------------------------- */

/** Compile-time exhaustiveness guard for discriminated-union switches. */
export function assertNever(value: never): never {
  throw new Error(`Unexpected variant: ${JSON.stringify(value)}`);
}
