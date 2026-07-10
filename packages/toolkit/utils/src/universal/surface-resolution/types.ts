/**
 * Surface-resolution record + provider SPI (MV-G25b/c).
 *
 * Contract: `docs/super-app-rfc-adr/RESOLUTION-0001-surface-discovery-record.md`.
 * Discovery answers a SurfaceRef with exactly ONE {@link ResolvedDeliveryUnit}
 * — never a bare URL, never a partial set of locations — or a typed
 * {@link DiscoveryError} (§2.4: discovery errors are expected states, not
 * exceptions).
 *
 * Atomicity invariant (ADR-0019): `buildMarker` / `sourceRevision` /
 * `baselineCohortId` live once on the record; a {@link ResolvedSurface}
 * carries no marker of its own, so mixing locations from two build markers is
 * structurally unrepresentable.
 */
import type { DeliveryUnitIdentity } from '../backend-federation-contract/types';
import type { ParsedSurfaceRef } from './surface-ref';

/* -------------------------------------------------------------------------- */
/* Locations (RESOLUTION-0001 §2.1)                                            */
/* -------------------------------------------------------------------------- */

export type ResolvedSurfaceLocationPlatform =
  | 'browser-mf-manifest'
  | 'node-mf-manifest'
  | 'http-api'
  | 'cloudflare-service-binding';

/**
 * One platform address for a surface, discriminated on `platform` so each
 * platform carries only the address shape its execution adapter can load.
 */
export type ResolvedSurfaceLocation =
  | { platform: 'browser-mf-manifest'; manifestUrl: string }
  | {
      /** Backend `backend-mf-manifest.json` URL or filesystem path. */
      platform: 'node-mf-manifest';
      manifestRef: string;
    }
  | { platform: 'http-api'; baseUrl: string; prefix: string }
  | {
      platform: 'cloudflare-service-binding';
      serviceBinding: string;
      dispatchNamespace?: string;
    };

/* -------------------------------------------------------------------------- */
/* Record                                                                      */
/* -------------------------------------------------------------------------- */

export type ResolvedSurfaceKind = 'component' | 'route' | 'api' | 'backend';

/**
 * A resolved surface. It carries NO build marker of its own: the marker lives
 * once on the {@link ResolvedDeliveryUnit} (ADR-0019 structural atomicity).
 */
export type ResolvedSurface = {
  surfaceId: string;
  kind: ResolvedSurfaceKind;
  locations: ResolvedSurfaceLocation[];
};

export type CompatibilityStatus = 'compatible' | 'incompatible' | 'degraded';

/** The resolver's verdict, not the consumer's guess (RESOLUTION-0001 §2.1). */
export type CompatibilityVerdict = {
  status: CompatibilityStatus;
  /** Baseline cohort id the verdict was computed against. */
  baselineCohortId: string;
  reason?: string;
};

/**
 * Atomic resolution result: every platform location for the unit, resolved
 * together against ONE `buildMarker` / `sourceRevision`. There is no partial
 * variant; a resolver returns this whole record or a {@link DiscoveryError}.
 */
export type ResolvedDeliveryUnit = DeliveryUnitIdentity & {
  baselineCohortId: string;
  surfaces: ResolvedSurface[];
  compatibility: CompatibilityVerdict;
};

/* -------------------------------------------------------------------------- */
/* Failure semantics (RESOLUTION-0001 §2.4)                                    */
/* -------------------------------------------------------------------------- */

export type DiscoveryErrorCode =
  | 'unknown-unit'
  | 'unknown-surface'
  | 'major-not-published'
  | 'identity-mismatch'
  | 'stale-record'
  | 'provider-unavailable';

export type DiscoveryError = {
  code: DiscoveryErrorCode;
  /** Canonical string form of the SurfaceRef being resolved. */
  ref: string;
  message: string;
  details?: Record<string, unknown>;
};

export type DiscoveryResult =
  | { ok: true; unit: ResolvedDeliveryUnit }
  | { ok: false; error: DiscoveryError };

/* -------------------------------------------------------------------------- */
/* Provider SPI (RESOLUTION-0001 §2.2)                                         */
/* -------------------------------------------------------------------------- */

/**
 * Environment identity. Providers are selected per environment, not per
 * surface: one environment resolves all surfaces of a unit through the same
 * provider chain.
 */
export type EnvironmentId = string;

export type SurfaceResolutionProvider = {
  /** Stable provider name (e.g. `env-static`), used in error details. */
  name: string;
  /**
   * Resolve a SurfaceRef in an environment to one complete record or one
   * typed error. Must never return a partial record and must never mix
   * locations from different build markers.
   */
  resolve(
    ref: ParsedSurfaceRef,
    env: EnvironmentId,
  ): DiscoveryResult | Promise<DiscoveryResult>;
};
