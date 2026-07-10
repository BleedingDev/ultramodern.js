/**
 * Identity / compatibility validation helpers for resolved delivery units
 * (MV-G25c). Runtime checks for records that crossed a serialization boundary;
 * within TypeScript the atomicity invariant is already structural.
 */
import { formatSurfaceRef, type ParsedSurfaceRef } from './surface-ref';
import type {
  DiscoveryError,
  DiscoveryErrorCode,
  ResolvedDeliveryUnit,
  ResolvedSurface,
} from './types';

const SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;

export type ResolvedDeliveryUnitIssue = {
  path: string;
  message: string;
};

export type ResolvedDeliveryUnitValidationResult = {
  ok: boolean;
  issues: ResolvedDeliveryUnitIssue[];
};

/** Build a typed {@link DiscoveryError} for a reference. */
export function createDiscoveryError(
  code: DiscoveryErrorCode,
  ref: ParsedSurfaceRef | string,
  message: string,
  details?: Record<string, unknown>,
): DiscoveryError {
  const refString = typeof ref === 'string' ? ref : formatSurfaceRef(ref);
  return details === undefined
    ? { code, ref: refString, message }
    : { code, ref: refString, message, details };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isValidUnitId(unitId: string): boolean {
  return unitId.split('/').every(segment => SEGMENT_PATTERN.test(segment));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const COMPATIBILITY_STATUSES: readonly string[] = [
  'compatible',
  'incompatible',
  'degraded',
];

const SURFACE_KINDS: readonly string[] = [
  'component',
  'route',
  'api',
  'backend',
];

const LOCATION_PLATFORMS: readonly string[] = [
  'browser-mf-manifest',
  'node-mf-manifest',
  'http-api',
  'cloudflare-service-binding',
];

/** Required non-empty string address fields per location platform. */
const LOCATION_REQUIRED_FIELDS: Record<string, readonly string[]> = {
  'browser-mf-manifest': ['manifestUrl'],
  'node-mf-manifest': ['manifestRef'],
  'http-api': ['baseUrl', 'prefix'],
  'cloudflare-service-binding': ['serviceBinding'],
};

type IssuePush = (path: string, message: string) => void;

function validateLocation(
  location: unknown,
  path: string,
  seenPlatforms: Set<string>,
  push: IssuePush,
): void {
  if (!isRecord(location)) {
    push(path, 'must be an object');
    return;
  }

  const platform = location.platform;
  if (typeof platform !== 'string' || !LOCATION_PLATFORMS.includes(platform)) {
    push(`${path}.platform`, `must be one of ${LOCATION_PLATFORMS.join(', ')}`);
    return;
  }

  if (seenPlatforms.has(platform)) {
    push(
      `${path}.platform`,
      `duplicate platform ${platform} within one surface`,
    );
  }
  seenPlatforms.add(platform);

  for (const field of LOCATION_REQUIRED_FIELDS[platform] ?? []) {
    if (!isNonEmptyString(location[field])) {
      push(`${path}.${field}`, 'must be a non-empty string');
    }
  }
  if (
    platform === 'cloudflare-service-binding' &&
    location.dispatchNamespace !== undefined &&
    !isNonEmptyString(location.dispatchNamespace)
  ) {
    push(
      `${path}.dispatchNamespace`,
      'must be a non-empty string when present',
    );
  }
}

function validateSurface(
  surface: unknown,
  path: string,
  seenSurfaceIds: Set<string>,
  push: IssuePush,
): void {
  if (!isRecord(surface)) {
    push(path, 'must be an object');
    return;
  }

  if (!isNonEmptyString(surface.surfaceId)) {
    push(`${path}.surfaceId`, 'must be a non-empty string');
  } else if (!SEGMENT_PATTERN.test(surface.surfaceId)) {
    push(`${path}.surfaceId`, 'must match the SurfaceRef SurfaceId grammar');
  } else if (seenSurfaceIds.has(surface.surfaceId)) {
    push(`${path}.surfaceId`, 'must be unique within the record');
  } else {
    seenSurfaceIds.add(surface.surfaceId);
  }

  if (
    typeof surface.kind !== 'string' ||
    !SURFACE_KINDS.includes(surface.kind)
  ) {
    push(`${path}.kind`, `must be one of ${SURFACE_KINDS.join(', ')}`);
  }

  if (
    surface.servedMajor !== undefined &&
    (!Number.isSafeInteger(surface.servedMajor) ||
      (surface.servedMajor as number) < 1)
  ) {
    push(`${path}.servedMajor`, 'must be a positive safe integer when present');
  }

  if (!Array.isArray(surface.locations)) {
    push(`${path}.locations`, 'must be an array of locations');
    return;
  }
  if (surface.locations.length === 0) {
    push(
      `${path}.locations`,
      'must contain at least one location (no partial records)',
    );
  }
  const seenPlatforms = new Set<string>();
  surface.locations.forEach((location, locationIndex) => {
    validateLocation(
      location,
      `${path}.locations[${locationIndex}]`,
      seenPlatforms,
      push,
    );
  });
}

/**
 * Validate the structural invariants of a {@link ResolvedDeliveryUnit}:
 * non-empty identity root, a well-formed compatibility verdict (valid status,
 * computed against the record-level baseline cohort), and per-surface
 * completeness (valid unique surface ids, valid kind, at least one location,
 * no duplicate platform entries, and every discriminant + required address
 * field per location platform). There is no partial-success shape: any issue
 * means the record is not a valid resolution.
 *
 * Total: never throws, even for records that crossed a serialization boundary
 * with missing or malformed nested objects — every defect is a typed issue.
 */
export function validateResolvedDeliveryUnit(
  unit: ResolvedDeliveryUnit,
): ResolvedDeliveryUnitValidationResult {
  const issues: ResolvedDeliveryUnitIssue[] = [];
  const push: IssuePush = (path, message) => {
    issues.push({ path, message });
  };

  if (!isRecord(unit)) {
    push('', 'must be an object');
    return { ok: false, issues };
  }
  // From here on treat the input as untrusted wire data.
  const raw = unit as unknown as Record<string, unknown>;

  if (!isNonEmptyString(raw.unitId)) {
    push('unitId', 'must be a non-empty string');
  } else if (!isValidUnitId(raw.unitId)) {
    push('unitId', 'must match the SurfaceRef UnitId grammar');
  }
  if (!isNonEmptyString(raw.buildMarker)) {
    push('buildMarker', 'must be a non-empty string');
  }
  if (!isNonEmptyString(raw.sourceRevision)) {
    push('sourceRevision', 'must be a non-empty string');
  }
  if (!isNonEmptyString(raw.baselineCohortId)) {
    push('baselineCohortId', 'must be a non-empty string');
  }

  const compatibility = raw.compatibility;
  if (!isRecord(compatibility)) {
    push('compatibility', 'must be an object');
  } else {
    if (
      typeof compatibility.status !== 'string' ||
      !COMPATIBILITY_STATUSES.includes(compatibility.status)
    ) {
      push(
        'compatibility.status',
        `must be one of ${COMPATIBILITY_STATUSES.join(', ')}`,
      );
    }
    if (compatibility.baselineCohortId !== raw.baselineCohortId) {
      push(
        'compatibility.baselineCohortId',
        'must equal the record-level baselineCohortId (one verdict per record)',
      );
    }
    if (
      compatibility.reason !== undefined &&
      !isNonEmptyString(compatibility.reason)
    ) {
      push('compatibility.reason', 'must be a non-empty string when present');
    }
  }

  if (!Array.isArray(raw.surfaces)) {
    push('surfaces', 'must be an array of surfaces');
    return { ok: false, issues };
  }
  if (raw.surfaces.length === 0) {
    push('surfaces', 'must contain at least one surface');
  }
  const seenSurfaceIds = new Set<string>();
  raw.surfaces.forEach((surface, surfaceIndex) => {
    validateSurface(surface, `surfaces[${surfaceIndex}]`, seenSurfaceIds, push);
  });

  return { ok: issues.length === 0, issues };
}

/**
 * Select the surface a {@link ParsedSurfaceRef} points at within one record.
 * `unknown-unit` when the record is for a different unit, `unknown-surface`
 * when the unit does not publish the surface.
 */
export function selectResolvedSurface(
  unit: ResolvedDeliveryUnit,
  ref: ParsedSurfaceRef,
):
  | { ok: true; surface: ResolvedSurface }
  | { ok: false; error: DiscoveryError } {
  if (unit.unitId !== ref.unitId) {
    return {
      ok: false,
      error: createDiscoveryError(
        'unknown-unit',
        ref,
        `Resolved record is for unit ${unit.unitId}, not ${ref.unitId}.`,
        { recordUnitId: unit.unitId },
      ),
    };
  }

  const surface = unit.surfaces.find(
    candidate => candidate.surfaceId === ref.surfaceId,
  );
  if (surface === undefined) {
    return {
      ok: false,
      error: createDiscoveryError(
        'unknown-surface',
        ref,
        `Unit ${unit.unitId} (buildMarker ${unit.buildMarker}) does not publish surface ${ref.surfaceId}.`,
        { availableSurfaces: unit.surfaces.map(entry => entry.surfaceId) },
      ),
    };
  }

  return { ok: true, surface };
}

export type ExpectedDeliveryUnitIdentity = {
  unitId: string;
  buildMarker: string;
};

/**
 * Compare a consumer's expected delivery-unit identity against a resolved
 * record. Execution adapters must pass the record's `unitId` + `buildMarker`
 * through to identity validation (RESOLUTION-0001 §2.3); a mismatch is the
 * typed `identity-mismatch` discovery error.
 */
export function matchDeliveryUnitIdentity(
  expected: ExpectedDeliveryUnitIdentity,
  unit: Pick<ResolvedDeliveryUnit, 'unitId' | 'buildMarker'>,
  ref: ParsedSurfaceRef | string,
): DiscoveryError | undefined {
  if (
    expected.unitId === unit.unitId &&
    expected.buildMarker === unit.buildMarker
  ) {
    return undefined;
  }

  return createDiscoveryError(
    'identity-mismatch',
    ref,
    `Delivery-unit identity mismatch: expected ${expected.unitId}@${expected.buildMarker}, resolved ${unit.unitId}@${unit.buildMarker}.`,
    {
      expected,
      resolved: { unitId: unit.unitId, buildMarker: unit.buildMarker },
    },
  );
}
