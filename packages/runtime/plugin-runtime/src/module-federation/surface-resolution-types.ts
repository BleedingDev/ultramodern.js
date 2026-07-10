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
