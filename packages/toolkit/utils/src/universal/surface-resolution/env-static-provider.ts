/**
 * env/static surface-resolution provider (MV-G25d) — the baseline provider of
 * RESOLUTION-0001 §2.2: assembles a complete {@link ResolvedDeliveryUnit} from
 * environment-configured values and static per-unit configuration. Works
 * offline, no external service.
 *
 * It unifies the two previously independent resolutions into ONE record:
 *
 * - browser MF manifest: the generated `createRemoteManifestUrl` chain
 *   (`packages/toolkit/create/src/ultramodern-workspace/module-federation/remote-refs.ts`)
 *   — `VERTICAL_<SEG>_MF_MANIFEST`, else `ULTRAMODERN_PUBLIC_URL_<SEG>` +
 *   `/mf-manifest.json`, else the Cloudflare workers.dev overlay, else the
 *   localhost dev fallback.
 * - node MF manifest: the backend manifest env convention
 *   (`VERTICAL_<SEG>_BACKEND_MF_MANIFEST`, see plugin-bff manifest reference
 *   resolution) with the generated localhost fallback.
 *
 * Failure semantics: partial is an error. If any declared platform location
 * for any surface cannot be assembled, the provider returns one typed
 * {@link DiscoveryError} and no record.
 */
import { formatSurfaceRef, type ParsedSurfaceRef } from './surface-ref';
import type {
  DiscoveryResult,
  EnvironmentId,
  ResolvedDeliveryUnit,
  ResolvedSurface,
  ResolvedSurfaceKind,
  ResolvedSurfaceLocation,
  SurfaceResolutionProvider,
} from './types';
import {
  createDiscoveryError,
  validateResolvedDeliveryUnit,
} from './validation';

export type EnvRecord = Record<string, string | undefined>;

/** Which platforms a surface publishes, plus their static (non-env) inputs. */
export type EnvStaticSurfacePlatforms = {
  /** Publish a `browser-mf-manifest` location (env/public/cloudflare/localhost chain). */
  browserMfManifest?: boolean;
  /** Publish a `node-mf-manifest` location (backend manifest env / localhost chain). */
  nodeMfManifest?: boolean;
  /** Publish an `http-api` location; the base URL follows the public-URL chain. */
  httpApi?: { prefix: string };
  /** Publish a `cloudflare-service-binding` location (statically provisioned). */
  cloudflareServiceBinding?: {
    serviceBinding: string;
    dispatchNamespace?: string;
  };
};

export type EnvStaticSurfaceConfig = {
  surfaceId: string;
  kind: ResolvedSurfaceKind;
  platforms: EnvStaticSurfacePlatforms;
};

/**
 * Static configuration for one delivery unit. Identity comes from the build
 * artifact (never from the environment); the environment only overrides
 * addresses through the documented env-var chains.
 */
export type EnvStaticUnitConfig = {
  unitId: string;
  buildMarker: string;
  sourceRevision: string;
  baselineCohortId: string;
  /**
   * Env-var segment, e.g. `CHECKOUT` in `VERTICAL_CHECKOUT_MF_MANIFEST` /
   * `ULTRAMODERN_PUBLIC_URL_CHECKOUT` (`toEnvSegment(domain ?? id)`).
   */
  envSegment: string;
  /** Module-federation container name (used to strip `mfName@` env prefixes). */
  mfName: string;
  /** Localhost dev fallback port. Without it, env values are mandatory. */
  port?: number;
  /** Cloudflare worker name for the workers.dev fallback. */
  workerName?: string;
  /** Externally published majors (ADR-0020). A requested `@vN` must be listed. */
  publishedMajors?: number[];
  surfaces: EnvStaticSurfaceConfig[];
};

export type EnvStaticProviderOptions = {
  units: EnvStaticUnitConfig[];
  /**
   * Environment record to read from. Universal module: `process.env` is never
   * read implicitly; pass it explicitly in Node hosts.
   */
  env?: EnvRecord;
};

export const ENV_STATIC_PROVIDER_NAME = 'env-static';

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/u, '');
}

function envValue(env: EnvRecord, name: string): string | undefined {
  const value = env[name]?.trim();
  return value !== undefined && value.length > 0 ? value : undefined;
}

/** Strip an optional `mfName@` remote-ref prefix from a configured manifest env value. */
function stripMfNamePrefix(value: string, mfName: string): string {
  return value.startsWith(`${mfName}@`)
    ? value.slice(mfName.length + 1)
    : value;
}

type LocationOutcome =
  | { ok: true; location: ResolvedSurfaceLocation }
  | { ok: false; reason: string; details?: Record<string, unknown> };

type EnvContext = {
  env: EnvRecord;
  cloudflareDeployEnabled: boolean;
  workersDevSubdomain: string | undefined;
  requireCloudflarePublicUrls: boolean;
};

function createEnvContext(env: EnvRecord): EnvContext {
  return {
    env,
    cloudflareDeployEnabled: env.MODERNJS_DEPLOY === 'cloudflare',
    workersDevSubdomain: envValue(
      env,
      'ULTRAMODERN_CLOUDFLARE_WORKERS_DEV_SUBDOMAIN',
    ),
    requireCloudflarePublicUrls:
      env.ULTRAMODERN_CLOUDFLARE_REQUIRE_PUBLIC_URLS === 'true',
  };
}

/**
 * Base-URL chain shared by the browser manifest and http-api locations:
 * public URL env, Cloudflare workers.dev overlay, localhost dev fallback.
 */
function resolveBaseUrl(
  context: EnvContext,
  unit: EnvStaticUnitConfig,
): LocationOutcomeBase {
  const publicUrlEnv = `ULTRAMODERN_PUBLIC_URL_${unit.envSegment}`;
  const configuredPublicUrl = envValue(context.env, publicUrlEnv);
  if (configuredPublicUrl !== undefined) {
    return { ok: true, baseUrl: trimTrailingSlashes(configuredPublicUrl) };
  }

  if (
    context.cloudflareDeployEnabled &&
    context.workersDevSubdomain !== undefined &&
    unit.workerName !== undefined
  ) {
    return {
      ok: true,
      baseUrl: `https://${unit.workerName}.${context.workersDevSubdomain}.workers.dev`,
    };
  }

  if (context.cloudflareDeployEnabled && context.requireCloudflarePublicUrls) {
    return {
      ok: false,
      reason: `Cloudflare deploy requires ${publicUrlEnv} (or a configured manifest env / ULTRAMODERN_CLOUDFLARE_WORKERS_DEV_SUBDOMAIN with a worker name)`,
      details: { publicUrlEnv },
    };
  }

  if (unit.port !== undefined) {
    return { ok: true, baseUrl: `http://localhost:${unit.port}` };
  }

  return {
    ok: false,
    reason: `No base URL available: set ${publicUrlEnv} or configure a localhost port`,
    details: { publicUrlEnv },
  };
}

type LocationOutcomeBase =
  | { ok: true; baseUrl: string }
  | { ok: false; reason: string; details?: Record<string, unknown> };

function resolveBrowserMfManifest(
  context: EnvContext,
  unit: EnvStaticUnitConfig,
): LocationOutcome {
  const manifestEnv = `VERTICAL_${unit.envSegment}_MF_MANIFEST`;
  const configuredManifest = envValue(context.env, manifestEnv);
  if (configuredManifest !== undefined) {
    return {
      ok: true,
      location: {
        platform: 'browser-mf-manifest',
        manifestUrl: stripMfNamePrefix(configuredManifest, unit.mfName),
      },
    };
  }

  const base = resolveBaseUrl(context, unit);
  if (!base.ok) {
    return {
      ok: false,
      reason: `browser-mf-manifest unavailable (${manifestEnv} unset; ${base.reason})`,
      details: { manifestEnv, ...base.details },
    };
  }

  return {
    ok: true,
    location: {
      platform: 'browser-mf-manifest',
      manifestUrl: `${base.baseUrl}/mf-manifest.json`,
    },
  };
}

function resolveNodeMfManifest(
  context: EnvContext,
  unit: EnvStaticUnitConfig,
): LocationOutcome {
  const manifestEnv = `VERTICAL_${unit.envSegment}_BACKEND_MF_MANIFEST`;
  const configuredManifest = envValue(context.env, manifestEnv);
  if (configuredManifest !== undefined) {
    return {
      ok: true,
      location: {
        platform: 'node-mf-manifest',
        manifestRef: configuredManifest,
      },
    };
  }

  if (unit.port !== undefined) {
    return {
      ok: true,
      location: {
        platform: 'node-mf-manifest',
        manifestRef: `http://localhost:${unit.port}/backend-mf-manifest.json`,
      },
    };
  }

  return {
    ok: false,
    reason: `node-mf-manifest unavailable: set ${manifestEnv} or configure a localhost port`,
    details: { manifestEnv },
  };
}

function resolveHttpApi(
  context: EnvContext,
  unit: EnvStaticUnitConfig,
  config: { prefix: string },
): LocationOutcome {
  const base = resolveBaseUrl(context, unit);
  if (!base.ok) {
    return {
      ok: false,
      reason: `http-api unavailable (${base.reason})`,
      details: base.details,
    };
  }
  return {
    ok: true,
    location: {
      platform: 'http-api',
      baseUrl: base.baseUrl,
      prefix: config.prefix,
    },
  };
}

function resolveCloudflareServiceBinding(config: {
  serviceBinding: string;
  dispatchNamespace?: string;
}): LocationOutcome {
  if (config.serviceBinding.length === 0) {
    return {
      ok: false,
      reason: 'cloudflare-service-binding unavailable: empty serviceBinding',
    };
  }
  return {
    ok: true,
    location: {
      platform: 'cloudflare-service-binding',
      serviceBinding: config.serviceBinding,
      ...(config.dispatchNamespace === undefined
        ? {}
        : { dispatchNamespace: config.dispatchNamespace }),
    },
  };
}

function resolveSurfaceLocations(
  context: EnvContext,
  unit: EnvStaticUnitConfig,
  surface: EnvStaticSurfaceConfig,
):
  | { ok: true; surface: ResolvedSurface }
  | { ok: false; reason: string; details?: Record<string, unknown> } {
  const outcomes: LocationOutcome[] = [];
  if (surface.platforms.browserMfManifest) {
    outcomes.push(resolveBrowserMfManifest(context, unit));
  }
  if (surface.platforms.nodeMfManifest) {
    outcomes.push(resolveNodeMfManifest(context, unit));
  }
  if (surface.platforms.httpApi !== undefined) {
    outcomes.push(resolveHttpApi(context, unit, surface.platforms.httpApi));
  }
  if (surface.platforms.cloudflareServiceBinding !== undefined) {
    outcomes.push(
      resolveCloudflareServiceBinding(
        surface.platforms.cloudflareServiceBinding,
      ),
    );
  }

  const failure = outcomes.find(outcome => !outcome.ok);
  if (failure !== undefined && !failure.ok) {
    return {
      ok: false,
      reason: `surface ${surface.surfaceId}: ${failure.reason}`,
      details: failure.details,
    };
  }

  const locations = outcomes.flatMap(outcome =>
    outcome.ok ? [outcome.location] : [],
  );
  if (locations.length === 0) {
    return {
      ok: false,
      reason: `surface ${surface.surfaceId} declares no platform locations`,
    };
  }

  return {
    ok: true,
    surface: { surfaceId: surface.surfaceId, kind: surface.kind, locations },
  };
}

/**
 * Create the baseline env/static provider. Resolution is all-or-nothing per
 * RESOLUTION-0001: every declared platform location for every surface of the
 * unit assembles against the unit's single static identity, or the whole
 * resolution fails with one typed error.
 */
export function createEnvStaticSurfaceResolutionProvider(
  options: EnvStaticProviderOptions,
): SurfaceResolutionProvider {
  const env = options.env ?? {};
  const unitsById = new Map(options.units.map(unit => [unit.unitId, unit]));

  return {
    name: ENV_STATIC_PROVIDER_NAME,
    resolve(
      ref: ParsedSurfaceRef,
      environment: EnvironmentId,
    ): DiscoveryResult {
      const refString = formatSurfaceRef(ref);
      const unit = unitsById.get(ref.unitId);
      if (unit === undefined) {
        return {
          ok: false,
          error: createDiscoveryError(
            'unknown-unit',
            refString,
            `No statically configured delivery unit ${ref.unitId}.`,
            { environment, knownUnits: [...unitsById.keys()] },
          ),
        };
      }

      if (!unit.surfaces.some(surface => surface.surfaceId === ref.surfaceId)) {
        return {
          ok: false,
          error: createDiscoveryError(
            'unknown-surface',
            refString,
            `Unit ${unit.unitId} does not declare surface ${ref.surfaceId}.`,
            {
              environment,
              availableSurfaces: unit.surfaces.map(
                surface => surface.surfaceId,
              ),
            },
          ),
        };
      }

      if (
        ref.major !== undefined &&
        !(unit.publishedMajors ?? []).includes(ref.major)
      ) {
        return {
          ok: false,
          error: createDiscoveryError(
            'major-not-published',
            refString,
            `Unit ${unit.unitId} does not publish external major v${ref.major}.`,
            { environment, publishedMajors: unit.publishedMajors ?? [] },
          ),
        };
      }

      const context = createEnvContext(env);
      const surfaces: ResolvedSurface[] = [];
      for (const surfaceConfig of unit.surfaces) {
        const resolved = resolveSurfaceLocations(context, unit, surfaceConfig);
        if (!resolved.ok) {
          // Partial is an error: one unassemblable location fails the record.
          return {
            ok: false,
            error: createDiscoveryError(
              'provider-unavailable',
              refString,
              `env-static provider cannot assemble a complete record for ${unit.unitId}: ${resolved.reason}.`,
              { environment, ...resolved.details },
            ),
          };
        }
        surfaces.push(resolved.surface);
      }

      const record: ResolvedDeliveryUnit = {
        unitId: unit.unitId,
        buildMarker: unit.buildMarker,
        sourceRevision: unit.sourceRevision,
        baselineCohortId: unit.baselineCohortId,
        surfaces,
        compatibility: {
          status: 'compatible',
          baselineCohortId: unit.baselineCohortId,
        },
      };

      const validation = validateResolvedDeliveryUnit(record);
      if (!validation.ok) {
        return {
          ok: false,
          error: createDiscoveryError(
            'provider-unavailable',
            refString,
            `env-static provider assembled an invalid record for ${unit.unitId}.`,
            { environment, issues: validation.issues },
          ),
        };
      }

      return { ok: true, unit: record };
    },
  };
}
