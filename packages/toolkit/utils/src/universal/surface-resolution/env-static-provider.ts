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
 *
 * Fail-closed environment semantics: localhost dev fallbacks (the `port`
 * chains) apply ONLY when the requested {@link EnvironmentId} is a designated
 * local environment ({@link EnvStaticProviderOptions.localEnvironments},
 * default `['development', 'local']`). Any other environment with missing
 * explicit configuration yields a typed `provider-unavailable` error.
 *
 * External majors (ADR-0020): a versioned SurfaceRef (`…@vN`) is served only
 * from a major-specific materialization declared in
 * {@link EnvStaticUnitConfig.majors}; each configured major resolves through
 * the same env chains under its own env segment (default
 * `${envSegment}_V${major}`) and never inherits the unversioned localhost
 * port or worker name. A requested major with no configured materialization
 * is the typed `major-not-published` error — unversioned locations are never
 * served for a versioned request. Served records stamp `servedMajor` on every
 * surface.
 *
 * Identity honesty (ADR-0019): this provider stamps STATIC identity
 * (`buildMarker` / `sourceRevision` / `baselineCohortId`) onto independently
 * resolved URLs; it never fetches the artifacts to verify them. Under the
 * default `identityVerification: 'static-trust'`, the compatibility verdict is
 * `{ status: 'compatible', reason: 'static-identity-unverified' }` — an
 * explicit machine-readable marker that identity was asserted, not verified.
 * Runtime identity validation (ADR-0019, `matchDeliveryUnitIdentity`) remains
 * the enforcement point.
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
  /**
   * Externally published majors (ADR-0020), each with its own materialization.
   * A requested `@vN` resolves ONLY through the matching entry; a major that
   * is not configured here is the typed `major-not-published` error.
   */
  majors?: EnvStaticMajorConfig[];
  surfaces: EnvStaticSurfaceConfig[];
};

/**
 * Per-major materialization (ADR-0020): where the externally published major
 * `vN` of a unit lives. Address inputs are deliberately NOT inherited from the
 * unversioned unit — a versioned request must never be answered with
 * unversioned locations — so each major carries its own env segment (default
 * `${unit.envSegment}_V${major}`) and, optionally, its own localhost port /
 * worker name.
 */
export type EnvStaticMajorConfig = {
  major: number;
  /** Env-var segment for this major. Default: `${unit.envSegment}_V${major}`. */
  envSegment?: string;
  /** Localhost dev fallback port for this major (local environments only). */
  port?: number;
  /** Cloudflare worker name for this major's workers.dev fallback. */
  workerName?: string;
};

/**
 * How the provider's stamped identity is to be interpreted. `static-trust`
 * (the only mode, and the default) means identity is asserted from static
 * config, not verified against the artifacts; the compatibility verdict then
 * carries `reason: 'static-identity-unverified'`.
 */
export type EnvStaticIdentityVerification = 'static-trust';

/** Environments in which localhost dev fallbacks are allowed by default. */
export const DEFAULT_LOCAL_ENVIRONMENTS: readonly string[] = [
  'development',
  'local',
];

export type EnvStaticProviderOptions = {
  units: EnvStaticUnitConfig[];
  /**
   * Environment record to read from. Universal module: `process.env` is never
   * read implicitly; pass it explicitly in Node hosts.
   */
  env?: EnvRecord;
  /**
   * Environments in which localhost dev fallbacks apply. Any environment NOT
   * listed here fails closed: missing explicit configuration is the typed
   * `provider-unavailable` error, never a localhost URL.
   * Default: `['development', 'local']`.
   */
  localEnvironments?: EnvironmentId[];
  /**
   * Identity-honesty mode (ADR-0019). Default `'static-trust'`: the verdict
   * is marked `static-identity-unverified` because this provider asserts
   * identity from static config without verifying the resolved artifacts.
   */
  identityVerification?: EnvStaticIdentityVerification;
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
  /**
   * Whether localhost dev fallbacks may be used. True only in designated
   * local environments; everywhere else missing config fails closed.
   */
  allowLocalFallback: boolean;
};

function createEnvContext(
  env: EnvRecord,
  allowLocalFallback: boolean,
): EnvContext {
  return {
    env,
    allowLocalFallback,
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

  if (unit.port !== undefined && context.allowLocalFallback) {
    return { ok: true, baseUrl: `http://localhost:${unit.port}` };
  }

  if (unit.port !== undefined) {
    return {
      ok: false,
      reason: `No base URL available: set ${publicUrlEnv} (localhost fallback is disabled outside designated local environments)`,
      details: { publicUrlEnv },
    };
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

  if (unit.port !== undefined && context.allowLocalFallback) {
    return {
      ok: true,
      location: {
        platform: 'node-mf-manifest',
        manifestRef: `http://localhost:${unit.port}/backend-mf-manifest.json`,
      },
    };
  }

  if (unit.port !== undefined) {
    return {
      ok: false,
      reason: `node-mf-manifest unavailable: set ${manifestEnv} (localhost fallback is disabled outside designated local environments)`,
      details: { manifestEnv },
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
  const localEnvironments = new Set(
    options.localEnvironments ?? DEFAULT_LOCAL_ENVIRONMENTS,
  );
  // 'static-trust' is currently the only mode; keeping it explicit makes the
  // identity-honesty marker below auditable at the call site.
  const identityVerification: EnvStaticIdentityVerification =
    options.identityVerification ?? 'static-trust';
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

      // A versioned request is served ONLY from the matching major-specific
      // materialization; unversioned locations are never substituted.
      let effectiveUnit = unit;
      if (ref.major !== undefined) {
        const majorConfig = (unit.majors ?? []).find(
          candidate => candidate.major === ref.major,
        );
        if (majorConfig === undefined) {
          return {
            ok: false,
            error: createDiscoveryError(
              'major-not-published',
              refString,
              `Unit ${unit.unitId} has no materialization for external major v${ref.major}.`,
              {
                environment,
                publishedMajors: (unit.majors ?? []).map(
                  candidate => candidate.major,
                ),
              },
            ),
          };
        }
        effectiveUnit = {
          ...unit,
          envSegment:
            majorConfig.envSegment ??
            `${unit.envSegment}_V${majorConfig.major}`,
          // Deliberately NOT inherited from the unversioned unit (fail closed).
          port: majorConfig.port,
          workerName: majorConfig.workerName,
        };
      }

      const context = createEnvContext(env, localEnvironments.has(environment));
      const surfaces: ResolvedSurface[] = [];
      for (const surfaceConfig of unit.surfaces) {
        const resolved = resolveSurfaceLocations(
          context,
          effectiveUnit,
          surfaceConfig,
        );
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
        surfaces.push(
          ref.major === undefined
            ? resolved.surface
            : { ...resolved.surface, servedMajor: ref.major },
        );
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
          // Identity honesty (ADR-0019): under static-trust the verdict marks
          // that identity was asserted from static config, not verified.
          ...(identityVerification === 'static-trust'
            ? { reason: 'static-identity-unverified' }
            : {}),
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
