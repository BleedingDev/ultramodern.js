/**
 * Surface-resolution types for the module-federation runtime.
 *
 * Thin re-export of the canonical module in `@modern-js/utils/universal`
 * (`packages/toolkit/utils/src/universal/surface-resolution/`,
 * RESOLUTION-0001). Kept as a file so existing `./surface-resolution-types`
 * imports stay stable. Only helpers the canonical module deliberately does not
 * ship (the (ref, env) cache key) live here, implemented against canonical
 * types.
 */
import {
  type EnvironmentId,
  formatSurfaceRef,
  type ParsedSurfaceRef,
} from '@modern-js/utils/universal';

export {
  type CompatibilityStatus,
  type CompatibilityVerdict,
  createDiscoveryError,
  type DiscoveryError,
  type DiscoveryErrorCode,
  type DiscoveryResult,
  type EnvironmentId,
  formatSurfaceRef,
  type ParsedSurfaceRef,
  parseSurfaceRef,
  type ResolvedDeliveryUnit,
  type ResolvedSurface,
  type ResolvedSurfaceKind,
  type ResolvedSurfaceLocation,
  type ResolvedSurfaceLocationPlatform,
  type SurfaceRefParseError,
  type SurfaceRefParseResult,
  type SurfaceResolutionProvider,
  validateSurfaceRef,
} from '@modern-js/utils/universal';

/** Stable cache/identity key for a (ref, env) pair. */
export function surfaceResolutionKey(
  ref: ParsedSurfaceRef,
  env: EnvironmentId,
): string {
  return `${env}::${formatSurfaceRef(ref)}`;
}

/**
 * Stable cache key for a (deliveryUnit, env) pair — ONE record per unit per
 * env (ADR-0019 atomicity). All surfaces of a unit share this key so a refresh
 * replaces the whole unit snapshot atomically for every surface, and two
 * surfaces of the same unit can never be served from different cached
 * snapshots. The ref's external-major participates in lookup validation (see
 * the LKG provider), not in this key.
 */
export function deliveryUnitResolutionKey(
  unitId: string,
  env: EnvironmentId,
): string {
  return `${env}::${unitId}`;
}
