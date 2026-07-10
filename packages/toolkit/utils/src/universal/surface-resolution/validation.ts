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

/**
 * Validate the structural invariants of a {@link ResolvedDeliveryUnit}:
 * non-empty identity root, one record-level baseline cohort that the
 * compatibility verdict was computed against, and per-surface completeness
 * (valid unique surface ids, at least one location, no duplicate platform
 * entries). There is no partial-success shape: any issue means the record is
 * not a valid resolution.
 */
export function validateResolvedDeliveryUnit(
  unit: ResolvedDeliveryUnit,
): ResolvedDeliveryUnitValidationResult {
  const issues: ResolvedDeliveryUnitIssue[] = [];
  const push = (path: string, message: string) => {
    issues.push({ path, message });
  };

  if (!isNonEmptyString(unit.unitId)) {
    push('unitId', 'must be a non-empty string');
  } else if (!isValidUnitId(unit.unitId)) {
    push('unitId', 'must match the SurfaceRef UnitId grammar');
  }
  if (!isNonEmptyString(unit.buildMarker)) {
    push('buildMarker', 'must be a non-empty string');
  }
  if (!isNonEmptyString(unit.sourceRevision)) {
    push('sourceRevision', 'must be a non-empty string');
  }
  if (!isNonEmptyString(unit.baselineCohortId)) {
    push('baselineCohortId', 'must be a non-empty string');
  }
  if (unit.compatibility.baselineCohortId !== unit.baselineCohortId) {
    push(
      'compatibility.baselineCohortId',
      'must equal the record-level baselineCohortId (one verdict per record)',
    );
  }

  if (unit.surfaces.length === 0) {
    push('surfaces', 'must contain at least one surface');
  }
  const seenSurfaceIds = new Set<string>();
  unit.surfaces.forEach((surface, surfaceIndex) => {
    const surfacePath = `surfaces[${surfaceIndex}]`;
    if (!isNonEmptyString(surface.surfaceId)) {
      push(`${surfacePath}.surfaceId`, 'must be a non-empty string');
    } else if (!SEGMENT_PATTERN.test(surface.surfaceId)) {
      push(
        `${surfacePath}.surfaceId`,
        'must match the SurfaceRef SurfaceId grammar',
      );
    } else if (seenSurfaceIds.has(surface.surfaceId)) {
      push(`${surfacePath}.surfaceId`, 'must be unique within the record');
    } else {
      seenSurfaceIds.add(surface.surfaceId);
    }

    if (surface.locations.length === 0) {
      push(
        `${surfacePath}.locations`,
        'must contain at least one location (no partial records)',
      );
    }
    const seenPlatforms = new Set<string>();
    surface.locations.forEach((location, locationIndex) => {
      if (seenPlatforms.has(location.platform)) {
        push(
          `${surfacePath}.locations[${locationIndex}].platform`,
          `duplicate platform ${location.platform} within one surface`,
        );
      }
      seenPlatforms.add(location.platform);
    });
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
