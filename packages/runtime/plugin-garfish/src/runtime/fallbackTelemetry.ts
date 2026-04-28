import { logger } from '../util';
import { RuntimeCompatibilityError } from './compatibility';
import { RemoteTrustPolicyError } from './trust';
import type {
  MfFallbackEvent,
  MfFallbackPhase,
  MfFallbackReason,
  MfFallbackTelemetryConfig,
  RuntimeParityCompatibilityDecision,
  RuntimeParityTrustDecision,
} from './useModuleApps';

const DEFAULT_EVENT_NAME = 'modernjs:mv-runtime-parity';
const DEFAULT_SERVER_REPORT_ENDPOINT =
  '/_modern/contract-gates/runtime-fallback';
const DEFAULT_SERVICE = 'modernjs';
const DEFAULT_MODULE = 'plugin-garfish';
const DEFAULT_RUNTIME_SURFACE = 'module-federation';
const DEFAULT_PARITY_CLAIM_ID = 'mv-runtime-parity';
const FALLBACK_CODE_BY_REASON: Record<MfFallbackReason, string> = {
  runtime_incompatible: 'MV_RUNTIME_INCOMPATIBLE',
  origin_not_allowed: 'MV_ORIGIN_NOT_ALLOWED',
  origin_isolation_violation: 'MV_ORIGIN_ISOLATION_VIOLATION',
  integrity_missing: 'MV_INTEGRITY_MISSING',
  integrity_mismatch: 'MV_INTEGRITY_MISMATCH',
  integrity_timeout: 'MV_INTEGRITY_TIMEOUT',
  attestation_missing: 'MV_ATTESTATION_MISSING',
  attestation_mismatch: 'MV_ATTESTATION_MISMATCH',
  entry_missing: 'MV_ENTRY_MISSING',
  entry_load_failed: 'MV_ENTRY_LOAD_FAILED',
  manifest_invalid: 'MV_MANIFEST_INVALID',
  manifest_unavailable: 'MV_MANIFEST_UNAVAILABLE',
  lifecycle_missing: 'MV_LIFECYCLE_MISSING',
  lifecycle_failed: 'MV_LIFECYCLE_FAILED',
  ssr_unavailable: 'MV_SSR_UNAVAILABLE',
  hydration_mismatch_risk: 'MV_HYDRATION_MISMATCH_RISK',
  timeout: 'MV_TIMEOUT',
  unknown: 'MV_UNKNOWN',
};
const FORBIDDEN_METADATA_KEYS = new Set([
  'rawAuthorizationHeader',
  'sessionCookie',
  'attestationSecret',
  'userPersonalData',
]);

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function getErrorCode(error: unknown) {
  if (error instanceof Error && 'code' in error) {
    return String((error as any).code);
  }
  return undefined;
}

function resolveErrorContext(
  error: unknown,
  appName?: string,
  entry?: string,
): {
  appName?: string;
  entry?: string;
} {
  if (error instanceof RuntimeCompatibilityError) {
    return {
      appName: appName ?? error.issue.appName,
      entry,
    };
  }

  if (error instanceof RemoteTrustPolicyError) {
    return {
      appName: appName ?? error.issue.appName,
      entry: entry ?? error.issue.entry,
    };
  }

  return {
    appName,
    entry,
  };
}

export function inferFallbackReason(error: unknown): MfFallbackReason {
  if (error instanceof RuntimeCompatibilityError) {
    return 'runtime_incompatible';
  }

  if (error instanceof RemoteTrustPolicyError) {
    switch (error.issue.reason) {
      case 'origin_not_allowed':
        return 'origin_not_allowed';
      case 'origin_isolation_violation':
        return 'origin_isolation_violation';
      case 'integrity_missing':
        return 'integrity_missing';
      case 'integrity_invalid_format':
        return 'integrity_mismatch';
      case 'integrity_mismatch':
        return 'integrity_mismatch';
      case 'integrity_fetch_failed':
        return 'entry_load_failed';
      case 'integrity_timeout':
      case 'integrity_verification_unavailable':
        return 'integrity_timeout';
      case 'attestation_missing':
        return 'attestation_missing';
      case 'attestation_mismatch':
        return 'attestation_mismatch';
      default:
        return 'unknown';
    }
  }

  return 'unknown';
}

export function inferFallbackPhase(
  error: unknown,
  defaultPhase: MfFallbackPhase = 'bootstrap',
): MfFallbackPhase {
  if (error instanceof RuntimeCompatibilityError) {
    return 'compatibility';
  }

  if (error instanceof RemoteTrustPolicyError) {
    switch (error.issue.reason) {
      case 'origin_not_allowed':
      case 'origin_isolation_violation':
      case 'attestation_missing':
      case 'attestation_mismatch':
        return 'trust';
      case 'integrity_fetch_failed':
        return 'load';
      case 'integrity_missing':
      case 'integrity_invalid_format':
      case 'integrity_timeout':
      case 'integrity_verification_unavailable':
      case 'integrity_mismatch':
        return 'integrity';
      default:
        return defaultPhase;
    }
  }

  return defaultPhase;
}

function resolveEnvironment(config?: MfFallbackTelemetryConfig) {
  return (
    config?.environment ||
    (typeof process !== 'undefined' && process.env.NODE_ENV) ||
    'development'
  );
}

function createTraceId(config?: MfFallbackTelemetryConfig) {
  if (config?.traceId) {
    return config.traceId;
  }

  const random =
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `mf-${random}`;
}

function sanitizeMetadata(metadata: Record<string, unknown> | undefined) {
  if (!metadata) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(metadata).filter(
      ([key]) => !FORBIDDEN_METADATA_KEYS.has(key),
    ),
  );
}

function inferTrustDecision(
  reason: MfFallbackReason,
  fallbackTrustDecision?: RuntimeParityTrustDecision,
): RuntimeParityTrustDecision {
  if (fallbackTrustDecision) {
    return fallbackTrustDecision;
  }

  switch (reason) {
    case 'origin_not_allowed':
    case 'origin_isolation_violation':
    case 'integrity_missing':
    case 'integrity_mismatch':
    case 'integrity_timeout':
    case 'attestation_missing':
    case 'attestation_mismatch':
      return 'blocked';
    case 'runtime_incompatible':
    case 'entry_load_failed':
    case 'lifecycle_failed':
    case 'timeout':
      return 'trusted';
    default:
      return 'unknown';
  }
}

function inferCompatibilityDecision(
  reason: MfFallbackReason,
  fallbackCompatibilityDecision?: RuntimeParityCompatibilityDecision,
): RuntimeParityCompatibilityDecision {
  if (fallbackCompatibilityDecision) {
    return fallbackCompatibilityDecision;
  }

  switch (reason) {
    case 'runtime_incompatible':
    case 'lifecycle_missing':
      return 'incompatible';
    case 'entry_load_failed':
    case 'lifecycle_failed':
    case 'timeout':
      return 'compatible';
    default:
      return 'unknown';
  }
}

function inferErrorTrustDecision(
  error: unknown,
  reason: MfFallbackReason,
): RuntimeParityTrustDecision {
  if (error instanceof RemoteTrustPolicyError) {
    return error.issue.reason === 'integrity_verification_unavailable'
      ? 'unknown'
      : 'blocked';
  }

  if (error instanceof RuntimeCompatibilityError) {
    return 'trusted';
  }

  return inferTrustDecision(reason);
}

function inferErrorCompatibilityDecision(
  error: unknown,
  reason: MfFallbackReason,
): RuntimeParityCompatibilityDecision {
  if (error instanceof RuntimeCompatibilityError) {
    return 'incompatible';
  }

  if (error instanceof RemoteTrustPolicyError) {
    return 'unknown';
  }

  return inferCompatibilityDecision(reason);
}

function normalizeFallbackPhase(
  reason: MfFallbackReason,
  phase: MfFallbackPhase,
): MfFallbackPhase {
  if (reason === 'entry_load_failed') {
    return 'load';
  }

  return phase;
}

type MfFallbackEventInput = Partial<
  Omit<MfFallbackEvent, 'reason' | 'phase' | 'timestamp'>
> & {
  reason: MfFallbackReason;
  phase: MfFallbackPhase;
};

export function createFallbackEvent(
  baseEvent: MfFallbackEventInput,
  config?: MfFallbackTelemetryConfig,
): MfFallbackEvent {
  const reason = baseEvent.reason;
  const phase = normalizeFallbackPhase(reason, baseEvent.phase);

  return {
    schemaVersion: baseEvent.schemaVersion ?? config?.schemaVersion ?? 1,
    timestamp: new Date().toISOString(),
    service: baseEvent.service ?? config?.service ?? DEFAULT_SERVICE,
    module: baseEvent.module ?? config?.module ?? DEFAULT_MODULE,
    environment: baseEvent.environment ?? resolveEnvironment(config),
    runtimeSurface:
      baseEvent.runtimeSurface ??
      config?.runtimeSurface ??
      DEFAULT_RUNTIME_SURFACE,
    appName: baseEvent.appName ?? 'unknown',
    ...baseEvent,
    phase,
    code: FALLBACK_CODE_BY_REASON[reason],
    trustDecision: inferTrustDecision(reason, baseEvent.trustDecision),
    compatibilityDecision: inferCompatibilityDecision(
      reason,
      baseEvent.compatibilityDecision,
    ),
    parityClaimId:
      baseEvent.parityClaimId ??
      config?.parityClaimId ??
      DEFAULT_PARITY_CLAIM_ID,
    traceId: baseEvent.traceId ?? createTraceId(config),
    spanId: baseEvent.spanId ?? config?.spanId,
    metadata: sanitizeMetadata(baseEvent.metadata),
  };
}

export function emitFallbackTelemetry(
  event: MfFallbackEventInput,
  config?: MfFallbackTelemetryConfig,
) {
  const payload = createFallbackEvent(event, config);

  config?.onFallback?.(payload);

  const shouldEmitConsole = config?.emitConsole ?? true;
  if (shouldEmitConsole) {
    logger('mf fallback telemetry', payload);
  }

  const shouldEmitWindowEvent = config?.emitWindowEvent ?? true;
  if (shouldEmitWindowEvent && typeof window !== 'undefined') {
    const eventName = config?.eventName || DEFAULT_EVENT_NAME;
    window.dispatchEvent(new CustomEvent(eventName, { detail: payload }));
  }

  reportFallbackTelemetry(payload, config);

  return payload;
}

export function emitErrorFallbackTelemetry(
  options: {
    error: unknown;
    phase: MfFallbackPhase;
    appName?: string;
    entry?: string;
    metadata?: Record<string, unknown>;
  },
  config?: MfFallbackTelemetryConfig,
) {
  const { error, phase, appName, entry, metadata } = options;
  const resolvedContext = resolveErrorContext(error, appName, entry);
  const reason = inferFallbackReason(error);
  return emitFallbackTelemetry(
    {
      reason,
      phase,
      appName: resolvedContext.appName,
      entry: resolvedContext.entry,
      metadata,
      message: getErrorMessage(error),
      code: getErrorCode(error),
      trustDecision: inferErrorTrustDecision(error, reason),
      compatibilityDecision: inferErrorCompatibilityDecision(error, reason),
    },
    config,
  );
}

function resolveReportEndpoint(endpoint: string | undefined) {
  if (typeof window === 'undefined') {
    return undefined;
  }

  const rawEndpoint = endpoint || DEFAULT_SERVER_REPORT_ENDPOINT;
  if (/^https?:\/\//i.test(rawEndpoint)) {
    return rawEndpoint;
  }

  try {
    return new URL(rawEndpoint, window.location.href).toString();
  } catch (_error) {
    return undefined;
  }
}

function reportFallbackTelemetry(
  payload: MfFallbackEvent,
  config: MfFallbackTelemetryConfig | undefined,
) {
  const shouldReportToServer = config?.reportToServer ?? true;
  if (!shouldReportToServer || typeof window === 'undefined') {
    return;
  }

  const endpoint = resolveReportEndpoint(config?.reportEndpoint);
  if (!endpoint) {
    return;
  }

  const body = JSON.stringify(payload);
  const reportHeaders = config?.reportHeaders || {};
  const hasCustomHeaders = Object.keys(reportHeaders).length > 0;
  const includeCredentials = config?.reportIncludeCredentials ?? false;

  const sendBeacon =
    typeof navigator !== 'undefined' &&
    typeof navigator.sendBeacon === 'function'
      ? navigator.sendBeacon.bind(navigator)
      : undefined;
  if (sendBeacon && !hasCustomHeaders && !includeCredentials) {
    try {
      sendBeacon(endpoint, body);
      return;
    } catch (_error) {
      // fallback to fetch path
    }
  }

  if (typeof fetch !== 'function') {
    return;
  }

  try {
    void fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...reportHeaders,
      },
      body,
      credentials: includeCredentials ? 'include' : 'same-origin',
      keepalive: true,
    }).catch(() => {
      // best-effort reporting only
    });
  } catch (_error) {
    // best-effort reporting only
  }
}
