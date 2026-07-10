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
 * required degraded handler.
 *
 * Criticality (owner-default 5: unclassified consumption is `critical`). For a
 * `noncritical` consumption the degraded handler's result is returned and the
 * failure is swallowed, so one failing consumption can never propagate to a
 * sibling (CONTEXT.md: faults isolate at the vertical boundary). For a
 * `critical` consumption the degraded handler still runs — telemetry and
 * fallback-UI obligations hold — but the returned promise then REJECTS with the
 * typed failure so callers and rollout machinery observe it. Critical
 * consumption during a rollout window should be driven by expand/contract, not
 * by silent degrade.
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
  createDiscoveryError,
  type DiscoveryError,
  type DiscoveryErrorCode,
  type DiscoveryResult,
  type EnvironmentId,
  formatSurfaceRef,
  type ParsedSurfaceRef,
  parseSurfaceRef,
  type ResolvedDeliveryUnit,
  type SurfaceResolutionProvider,
  validateSurfaceRef,
} from './surface-resolution-types';

/** Where in the consumption lifecycle a failure was raised. */
export type SurfaceConsumptionPhase = 'discovery' | 'load' | 'mount';

/**
 * The typed failure surfaced to the degraded handler. Exactly one of
 * `discoveryError` (resolver returned a typed {@link DiscoveryError}) or
 * `error` (something threw) is populated for a given failure.
 */
export type SurfaceConsumptionFailure = {
  ref: ParsedSurfaceRef;
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
  ref: ParsedSurfaceRef;
  env: EnvironmentId;
};

export type SurfaceConsumerOptions<T> = {
  /** The logical surface to consume (object or canonical string form). */
  ref: ParsedSurfaceRef | string;
  env: EnvironmentId;
  /** The pluggable resolution seam (RESOLUTION-0001 §2.2). */
  provider: SurfaceResolutionProvider;
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
  /**
   * Consumption criticality (owner-default 5). Defaults to `'critical'` when
   * omitted.
   *
   * - `'noncritical'`: the degraded handler's result is returned and the
   *   failure is swallowed — the promise never rejects.
   * - `'critical'`: the degraded handler still runs (telemetry + fallback-UI
   *   obligations hold), but the returned promise then REJECTS with the typed
   *   failure so callers / rollout machinery observe it. Prefer expand/contract
   *   over silent degrade for critical surfaces during rollout windows.
   */
  classification?: 'critical' | 'noncritical';
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

/**
 * Canonical string form of a ref, without the never-throws guarantee of
 * consumeSurface depending on the caller having passed a grammatically valid
 * object ref (canonical formatSurfaceRef throws on invalid refs).
 */
function toRemoteString(ref: ParsedSurfaceRef): string {
  return validateSurfaceRef(ref) === undefined
    ? formatSurfaceRef(ref)
    : `${ref.unitId}#${ref.surfaceId}`;
}

async function reportFailure<T>(
  options: SurfaceConsumerOptions<T>,
  ref: ParsedSurfaceRef,
  base: {
    phase: SurfaceConsumptionPhase;
    classification: ModuleFederationFallbackClassification;
    discoveryError?: DiscoveryError;
    error?: unknown;
    resolved?: ResolvedDeliveryUnit;
  },
): Promise<T> {
  const remote = toRemoteString(ref);
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

  const critical = (options.classification ?? 'critical') === 'critical';

  // The ORIGINAL typed failure a critical consumption rejects with: the typed
  // discovery error, else the thrown error, else a synthesized discovery error
  // for the incompatible-verdict path (which carries neither).
  const reason: unknown =
    base.discoveryError ??
    (base.error !== undefined
      ? base.error
      : createDiscoveryError(
          'identity-mismatch',
          remote,
          `resolved record for "${remote}" is incompatible`,
          { env: options.env },
        ));

  let degradedValue: T;
  try {
    degradedValue = await options.degraded(failure);
  } catch (handlerError) {
    // Degraded-handler rejection containment: a throwing/rejecting degraded
    // handler must not propagate unconditionally. Emit handler-failure
    // telemetry, then for noncritical resolve undefined; for critical reject
    // with the ORIGINAL typed error (never the handler's).
    try {
      await emitModuleFederationFallbackTelemetry(
        {
          appName: options.appName,
          classification: base.classification,
          error: handlerError,
          metadata: { ...telemetry.metadata, degradedHandlerFailed: true },
          phase: base.phase,
          remote,
          status: 'failed',
        },
        options.telemetry ?? {},
      );
    } catch {
      // Telemetry sink failure must never mask the containment path.
    }
    if (critical) {
      throw reason;
    }
    return undefined as T;
  }

  if (critical) {
    throw reason;
  }
  return degradedValue;
}

/**
 * Consume one surface with a mandatory degraded fallback. On any discovery or
 * load failure the required degraded handler runs (telemetry + fallback UI).
 *
 * For a `noncritical` consumption (see {@link SurfaceConsumerOptions.classification})
 * this resolves to the degraded value and never rejects, so a failing
 * consumption is isolated from any sibling. For a `critical` consumption (the
 * default) it rejects with the typed failure AFTER the degraded handler has
 * run, so callers / rollout machinery observe the failure.
 */
export async function consumeSurface<T>(
  options: SurfaceConsumerOptions<T>,
): Promise<T> {
  let ref: ParsedSurfaceRef;
  if (typeof options.ref === 'string') {
    const parsed = parseSurfaceRef(options.ref);
    if (!parsed.ok) {
      // A malformed ref can never resolve; degrade without calling the
      // provider (providers only accept grammatically valid refs).
      const hashIndex = options.ref.indexOf('#');
      const echoed: ParsedSurfaceRef =
        hashIndex === -1
          ? { unitId: options.ref, surfaceId: '' }
          : {
              unitId: options.ref.slice(0, hashIndex),
              surfaceId: options.ref.slice(hashIndex + 1),
            };
      return reportFailure(options, echoed, {
        phase: 'discovery',
        classification: 'remote-unavailable',
        discoveryError: createDiscoveryError(
          'unknown-surface',
          options.ref,
          `SurfaceRef "${options.ref}" is not a valid canonical reference (${parsed.error.code}).`,
          { parseError: parsed.error, env: options.env },
        ),
      });
    }
    ref = parsed.ref;
  } else {
    ref = options.ref;
  }

  let resolution: DiscoveryResult;
  try {
    resolution = await options.provider.resolve(ref, options.env);
  } catch (error) {
    return reportFailure(options, ref, {
      phase: 'discovery',
      classification: classifyModuleFederationFallback(error),
      error,
    });
  }

  if (!resolution.ok) {
    return reportFailure(options, ref, {
      phase: 'discovery',
      classification: classifyDiscoveryError(resolution.error.code),
      discoveryError: resolution.error,
    });
  }

  const resolved = resolution.unit;

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
