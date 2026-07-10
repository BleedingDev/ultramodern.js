// @effect-diagnostics strictBooleanExpressions:off
/**
 * TODO(integration): replace with `@modern-js/utils/universal/surface-resolution`.
 *
 * A sibling lane is creating
 * `packages/toolkit/utils/src/universal/surface-resolution/` (SurfaceRef,
 * ResolvedDeliveryUnit, DiscoveryError, provider SPI) per RESOLUTION-0001. That
 * module does not exist in this worktree yet, so this file mirrors the exact
 * shapes from RESOLUTION-0001 §2.2/§2.4 and
 * `packages/toolkit/create/src/ultramodern-workspace/delivery-unit-schema/types.ts`.
 * The integrator reconciles these local mirrors with the canonical module.
 */

/** An environment selector (RESOLUTION-0001 §2.2: providers are per-env). */
export type EnvironmentId = string;

/** A concrete per-platform address (delivery-unit-schema types.ts). */
export type SurfaceLocation =
  | { platform: 'browser-mf'; manifestUrl: string }
  | { platform: 'node-mf'; manifestUrl: string }
  | { platform: 'http'; address: string }
  | { platform: 'cloudflare-binding'; serviceBinding: string };

export type SurfaceKind = 'component' | 'route' | 'api' | 'backend';

/**
 * Parsed SurfaceRef object form. Canonical string is `unitId#surfaceId` with an
 * optional `@vN` external-major suffix (delivery-unit-schema SPEC §2).
 */
export type SurfaceRef = {
  unitId: string;
  surfaceId: string;
  /** External-major selector. Absent means "the coordinated-zone surface". */
  major?: number;
};

/** A resolved surface. Carries NO build marker of its own (marker is unit-level). */
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
 * Atomic resolution result (RESOLUTION-0001 §2.1, delivery-unit-schema §3).
 * Every platform location resolves together against ONE buildMarker /
 * sourceRevision. There is no partial variant.
 */
export type ResolvedDeliveryUnit = {
  unitId: string;
  buildMarker: string;
  sourceRevision: string;
  baselineCohortId: string;
  surfaces: ResolvedSurface[];
  compatibility: CompatibilityVerdict;
};

/** RESOLUTION-0001 §2.4 — typed, exhaustive discovery failures. */
export type DiscoveryErrorCode =
  | 'unknown-unit'
  | 'unknown-surface'
  | 'major-not-published'
  | 'identity-mismatch'
  | 'stale-record'
  | 'provider-unavailable';

export type DiscoveryError = {
  kind: 'discovery-error';
  code: DiscoveryErrorCode;
  message: string;
  ref: SurfaceRef;
  env: EnvironmentId;
};

/** A resolver either yields one whole record or a typed failure — never partial. */
export type SurfaceResolution = ResolvedDeliveryUnit | DiscoveryError;

/**
 * The pluggable resolution seam (RESOLUTION-0001 §2.2):
 * `resolve(ref, env) -> ResolvedDeliveryUnit | DiscoveryError`.
 */
export type SurfaceProvider = {
  resolve(
    ref: SurfaceRef,
    env: EnvironmentId,
  ): Promise<SurfaceResolution> | SurfaceResolution;
};

export function isDiscoveryError(
  resolution: SurfaceResolution,
): resolution is DiscoveryError {
  return (resolution as DiscoveryError).kind === 'discovery-error';
}

/** Render a SurfaceRef to its canonical string form. */
export function formatSurfaceRef(ref: SurfaceRef): string {
  const base = `${ref.unitId}#${ref.surfaceId}`;
  return ref.major === undefined ? base : `${base}@v${ref.major}`;
}

/**
 * Minimal SurfaceRef coercion. Accepts an object ref or the canonical string
 * form. This is a deliberately small parse; the canonical total parser lives in
 * the create package and will replace it on integration.
 */
export function toSurfaceRef(ref: SurfaceRef | string): SurfaceRef {
  if (typeof ref !== 'string') {
    return ref;
  }

  const hashIndex = ref.indexOf('#');
  if (hashIndex === -1) {
    return { unitId: ref, surfaceId: '' };
  }

  const unitId = ref.slice(0, hashIndex);
  const rest = ref.slice(hashIndex + 1);
  const atIndex = rest.indexOf('@');
  if (atIndex === -1) {
    return { unitId, surfaceId: rest };
  }

  const surfaceId = rest.slice(0, atIndex);
  const majorPart = rest.slice(atIndex + 1);
  const major = /^v[1-9][0-9]*$/.test(majorPart)
    ? Number(majorPart.slice(1))
    : undefined;
  return major === undefined
    ? { unitId, surfaceId }
    : { unitId, surfaceId, major };
}

/** Stable cache/identity key for a (ref, env) pair. */
export function surfaceResolutionKey(
  ref: SurfaceRef,
  env: EnvironmentId,
): string {
  return `${env}::${formatSurfaceRef(ref)}`;
}
