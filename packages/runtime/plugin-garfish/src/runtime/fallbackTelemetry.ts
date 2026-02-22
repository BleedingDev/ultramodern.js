import { logger } from '../util';
import { RuntimeCompatibilityError } from './compatibility';
import { RemoteTrustPolicyError } from './trust';
import type {
  MfFallbackEvent,
  MfFallbackReason,
  MfFallbackTelemetryConfig,
} from './useModuleApps';

const DEFAULT_EVENT_NAME = 'modernjs:mf-fallback';

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
        return 'integrity_invalid';
      case 'integrity_mismatch':
        return 'integrity_mismatch';
      case 'integrity_fetch_failed':
        return 'integrity_fetch_failed';
      case 'integrity_timeout':
      case 'integrity_verification_unavailable':
        return 'integrity_timeout';
      case 'attestation_missing':
        return 'attestation_missing';
      case 'attestation_mismatch':
        return 'attestation_mismatch';
      default:
        return 'runtime_init_failed';
    }
  }

  return 'runtime_init_failed';
}

export function createFallbackEvent(
  baseEvent: Omit<MfFallbackEvent, 'timestamp'>,
): MfFallbackEvent {
  return {
    ...baseEvent,
    timestamp: Date.now(),
  };
}

export function emitFallbackTelemetry(
  event: Omit<MfFallbackEvent, 'timestamp'>,
  config?: MfFallbackTelemetryConfig,
) {
  const payload = createFallbackEvent(event);

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

  return payload;
}

export function emitErrorFallbackTelemetry(
  options: {
    error: unknown;
    phase: MfFallbackEvent['phase'];
    appName?: string;
    entry?: string;
    metadata?: Record<string, unknown>;
  },
  config?: MfFallbackTelemetryConfig,
) {
  const { error, phase, appName, entry, metadata } = options;
  return emitFallbackTelemetry(
    {
      reason: inferFallbackReason(error),
      phase,
      appName,
      entry,
      metadata,
      message: getErrorMessage(error),
      code: getErrorCode(error),
    },
    config,
  );
}
