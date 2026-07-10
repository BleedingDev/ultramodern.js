// @effect-diagnostics asyncFunction:off strictBooleanExpressions:off
/**
 * G22 — mandatory degraded consumption API.
 *
 * CONTEXT.md (Degraded State): "consuming a surface obliges the consumer to
 * define a degraded state". This module turns that obligation into a
 * compile-level one: {@link SurfaceConsumerOptions.degraded} is a REQUIRED
 * field, so a call site that forgets its fallback does not type-check.
 *
 * The consumer wraps the loadRemote-ish flow (resolve a SurfaceRef through a
 * provider, then load the execution artifact from the resolved record) and
 * guarantees isolation: any discovery/load failure is caught, classified,
 * reported through the existing MF fallback telemetry, and handed to the
 * required degraded handler — it never throws, so one failing consumption can
 * never propagate to a sibling consumption (CONTEXT.md: faults isolate at the
 * vertical boundary).
 */
import {
  classifyModuleFederationFallback,
  createModuleFederationFallbackTelemetry,
  emitModuleFederationFallbackTelemetry,
  type ModuleFederationFallbackClassification,
  type ModuleFederationFallbackTelemetryEmitOptions,
  type ModuleFederationFallbackTelemetryPayload,
} from './index';
import {
  type DiscoveryError,
  type DiscoveryErrorCode,
  type EnvironmentId,
  formatSurfaceRef,
  isDiscoveryError,
  type ResolvedDeliveryUnit,
  type SurfaceProvider,
  type SurfaceRef,
  toSurfaceRef,
} from './surface-resolution-types';

/** Where in the consumption lifecycle a failure was raised. */
export type SurfaceConsumptionPhase = 'discovery' | 'load' | 'mount';

/**
 * The typed failure surfaced to the degraded handler. Exactly one of
 * `discoveryError` (resolver returned a typed {@link DiscoveryError}) or
 * `error` (something threw) is populated for a given failure.
 */
export type SurfaceConsumptionFailure = {
  ref: SurfaceRef;
  env: EnvironmentId;
  phase: SurfaceConsumptionPhase;
  classification: ModuleFederationFallbackClassification;
  /** Present when discovery returned a typed error state. */
  discoveryError?: DiscoveryError;
  /** Present when a thrown error caused the failure. */
  error?: unknown;
  /** The resolved record, when discovery succeeded but load/mount failed. */
  resolved?: ResolvedDeliveryUnit;
  /** The fallback telemetry payload emitted for this failure. */
  telemetry: ModuleFederationFallbackTelemetryPayload;
};

export type SurfaceLoadInput = {
  resolved: ResolvedDeliveryUnit;
  ref: SurfaceRef;
  env: EnvironmentId;
};

export type SurfaceConsumerOptions<T> = {
  /** The logical surface to consume (object or canonical string form). */
  ref: SurfaceRef | string;
  env: EnvironmentId;
  /** The pluggable resolution seam (RESOLUTION-0001 §2.2). */
  provider: SurfaceProvider;
  /** Consumer app name, used for telemetry attribution. */
  appName: string;
  /**
   * Loads the execution artifact from a resolved record — the loadRemote-ish
   * flow. Receives the whole {@link ResolvedDeliveryUnit} so the adapter reads
   * locations under one buildMarker (RESOLUTION-0001 §2.3).
   */
  load: (input: SurfaceLoadInput) => Promise<T> | T;
  /**
   * REQUIRED degraded handler (G22 compile-level obligation). There is no
   * default and no way to opt out at the type level: omitting this field is a
   * compile error. Return the value to serve while the surface is unavailable
   * or incompatible.
   */
  degraded: (failure: SurfaceConsumptionFailure) => T | Promise<T>;
  /** Optional telemetry emission options (endpoint/auth/fetch overrides). */
  telemetry?: ModuleFederationFallbackTelemetryEmitOptions;
};

/** Map a typed discovery-error code onto the MF fallback classification space. */
function classifyDiscoveryError(
  code: DiscoveryErrorCode,
): ModuleFederationFallbackClassification {
  switch (code) {
    case 'major-not-published':
    case 'stale-record':
      return 'version-skew';
    case 'identity-mismatch':
      return 'contract';
    case 'unknown-unit':
    case 'unknown-surface':
    case 'provider-unavailable':
      return 'remote-unavailable';
    default: {
      // Exhaustiveness guard: a new code must be classified explicitly.
      const _never: never = code;
      return 'remote-unavailable';
    }
  }
}

async function reportFailure<T>(
  options: SurfaceConsumerOptions<T>,
  ref: SurfaceRef,
  base: {
    phase: SurfaceConsumptionPhase;
    classification: ModuleFederationFallbackClassification;
    discoveryError?: DiscoveryError;
    error?: unknown;
    resolved?: ResolvedDeliveryUnit;
  },
): Promise<T> {
  const remote = formatSurfaceRef(ref);
  const telemetry = createModuleFederationFallbackTelemetry({
    appName: options.appName,
    classification: base.classification,
    error: base.error ?? base.discoveryError,
    metadata: {
      env: options.env,
      surfaceRef: remote,
      ...(base.discoveryError
        ? { discoveryErrorCode: base.discoveryError.code }
        : {}),
      ...(base.resolved ? { buildMarker: base.resolved.buildMarker } : {}),
    },
    phase: base.phase,
    remote,
    status: 'degraded',
  });

  // Fire-and-forget style, but awaited so tests can assert emission. Emission
  // failures must never mask the degraded path.
  try {
    await emitModuleFederationFallbackTelemetry(
      {
        appName: options.appName,
        classification: base.classification,
        error: base.error ?? base.discoveryError,
        metadata: telemetry.metadata,
        phase: base.phase,
        remote,
        status: 'degraded',
      },
      options.telemetry ?? {},
    );
  } catch {
    // Telemetry sink failure is itself a degraded condition; swallow it.
  }

  const failure: SurfaceConsumptionFailure = {
    ref,
    env: options.env,
    phase: base.phase,
    classification: base.classification,
    telemetry,
  };
  if (base.discoveryError) {
    failure.discoveryError = base.discoveryError;
  }
  if (base.error !== undefined) {
    failure.error = base.error;
  }
  if (base.resolved) {
    failure.resolved = base.resolved;
  }

  return options.degraded(failure);
}

/**
 * Consume one surface with a mandatory degraded fallback. Always resolves to a
 * value of `T`: on any discovery or load failure the required degraded handler
 * supplies the value. This function never rejects, so a failing consumption is
 * isolated from any sibling consumption.
 */
export async function consumeSurface<T>(
  options: SurfaceConsumerOptions<T>,
): Promise<T> {
  const ref = toSurfaceRef(options.ref);

  let resolution;
  try {
    resolution = await options.provider.resolve(ref, options.env);
  } catch (error) {
    return reportFailure(options, ref, {
      phase: 'discovery',
      classification: classifyModuleFederationFallback(error),
      error,
    });
  }

  if (isDiscoveryError(resolution)) {
    return reportFailure(options, ref, {
      phase: 'discovery',
      classification: classifyDiscoveryError(resolution.code),
      discoveryError: resolution,
    });
  }

  const resolved = resolution;

  // A resolver may hand back a record it already judged incompatible; treat it
  // as a degraded consumption rather than loading against a bad contract.
  if (resolved.compatibility.status === 'incompatible') {
    return reportFailure(options, ref, {
      phase: 'discovery',
      classification: 'contract',
      resolved,
    });
  }

  try {
    return await options.load({ resolved, ref, env: options.env });
  } catch (error) {
    return reportFailure(options, ref, {
      phase: 'load',
      classification: classifyModuleFederationFallback(error),
      error,
      resolved,
    });
  }
}

/**
 * Build a reusable consumer bound to a provider/env/app, still requiring a
 * degraded handler per call. Per-call options override the bound base.
 */
export function createSurfaceConsumer(
  base: Pick<
    SurfaceConsumerOptions<unknown>,
    'provider' | 'env' | 'appName' | 'telemetry'
  >,
) {
  return function consume<T>(
    options: Omit<SurfaceConsumerOptions<T>, keyof typeof base> &
      Partial<Pick<SurfaceConsumerOptions<T>, keyof typeof base>>,
  ): Promise<T> {
    return consumeSurface<T>({
      ...base,
      ...options,
    } as SurfaceConsumerOptions<T>);
  };
}
