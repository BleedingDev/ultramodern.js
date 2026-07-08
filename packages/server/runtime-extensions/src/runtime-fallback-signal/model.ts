import type { Context, ServerEnv } from '@modern-js/server-core';
import type { ContractGateSnapshotStore } from '../contract-gate-snapshot-store';

export const DEFAULT_RUNTIME_FALLBACK_SIGNAL_ENDPOINT =
  '/_modern/contract-gates/runtime-fallback';
export const DEFAULT_RUNTIME_STATUS_ENDPOINT = '/_modern/runtime/status';
export const DEFAULT_RUNTIME_FALLBACK_GATE_NAME = 'runtime-mf-fallback-health';
export const DEFAULT_RUNTIME_FALLBACK_FAILURE_HOLD_MS = 5 * 60_000;
export const DEFAULT_RUNTIME_FALLBACK_MAX_BODY_BYTES = 16 * 1024;
export const DEFAULT_RUNTIME_FALLBACK_AUTH_HEADER =
  'x-modernjs-runtime-signal-token';
export const DEFAULT_RUNTIME_FALLBACK_TRUST_MAX_SIGNALS_PER_WINDOW = 30;
export const DEFAULT_RUNTIME_FALLBACK_TRUST_WINDOW_MS = 60_000;
export const DEFAULT_RUNTIME_FALLBACK_TRUST_DEDUPE_WINDOW_MS = 10_000;

export type RuntimeSignalErrorCode =
  | 'PAYLOAD_TOO_LARGE'
  | 'INVALID_PAYLOAD'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'UNTRUSTED_SOURCE';

export type RuntimeSignalError = Error & {
  code?: RuntimeSignalErrorCode;
};

export type RuntimeFallbackSignalTrustPolicy = {
  allowedApps: string[];
  allowedEntryOrigins: string[];
  expectedRuntimeDigests: Record<string, string>;
  enforceRuntimeDigest: boolean;
  maxSignalsPerWindow: number;
  windowMs: number;
  dedupeWindowMs: number;
};

type RuntimeFallbackSignalRateLimitState = {
  count: number;
  windowStartedAt: number;
};

export type RuntimeFallbackSignalAuthConfig = {
  enabled: boolean;
  headerName: string;
  expectedValue?: string;
};

export type RuntimeFallbackSignalRuntimeState = {
  rateLimitBySource: Map<string, RuntimeFallbackSignalRateLimitState>;
  dedupeByFingerprint: Map<string, number>;
};

export type RuntimeFallbackSignalTrustContext = {
  trustPolicy: RuntimeFallbackSignalTrustPolicy;
  runtimeState: RuntimeFallbackSignalRuntimeState;
};

export type RuntimeFallbackSignalConfig = {
  endpoint: string;
  gateName: string;
  gateSnapshotStore: Promise<ContractGateSnapshotStore>;
  failureHoldMs: number;
  maxBodyBytes: number;
  auth: RuntimeFallbackSignalAuthConfig;
  trustPolicy: RuntimeFallbackSignalTrustPolicy;
  runtimeState: RuntimeFallbackSignalRuntimeState;
};

export type RuntimeFallbackSignalSource = {
  /**
   * Server-trusted connection identity (socket remote address). Never derive
   * request headers or payload: both are attacker-controlled and would let
   * callers reset their own rate-limit budget.
   */
  remoteAddress?: string;
};

export function createRuntimeSignalError(
  message: string,
  code: RuntimeSignalError['code'],
) {
  const error = new Error(message) as RuntimeSignalError;
  error.code = code;
  return error;
}

export function getRuntimeSignalErrorStatusCode(
  signalError: RuntimeSignalError,
): 400 | 401 | 403 | 413 | 429 | 500 {
  if (signalError.code === 'PAYLOAD_TOO_LARGE') {
    return 413;
  }
  if (signalError.code === 'INVALID_PAYLOAD') {
    return 400;
  }
  if (signalError.code === 'UNAUTHORIZED') {
    return 401;
  }
  if (signalError.code === 'RATE_LIMITED') {
    return 429;
  }
  if (signalError.code === 'UNTRUSTED_SOURCE') {
    return 403;
  }
  return 500;
}

export function normalizeRuntimeSignalOrigin(value: unknown) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  try {
    return new URL(value).origin;
  } catch (_error) {
    return undefined;
  }
}

export function normalizeRuntimeSignalAppName(
  payload: Record<string, unknown>,
) {
  if (typeof payload.appName !== 'string') {
    return 'unknown';
  }

  const normalized = payload.appName.trim();
  return normalized.length > 0 ? normalized : 'unknown';
}

export function normalizeRuntimeSignalRuntimeDigest(
  payload: Record<string, unknown>,
) {
  if (
    typeof payload.runtimeDigest === 'string' &&
    payload.runtimeDigest.trim()
  ) {
    return payload.runtimeDigest.trim();
  }

  const metadata = payload.metadata;
  if (
    metadata &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata) &&
    typeof (metadata as Record<string, unknown>).runtimeDigest === 'string'
  ) {
    const digest = String(
      (metadata as Record<string, unknown>).runtimeDigest,
    ).trim();
    if (digest) {
      return digest;
    }
  }

  return undefined;
}

function getUtf8ByteLength(input: string) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.byteLength(input);
  }

  return new TextEncoder().encode(input).length;
}

export async function parseRuntimeFallbackSignalPayload(
  c: Context<ServerEnv>,
  maxBodyBytes: number,
) {
  const contentLengthHeader = c.req.header('content-length');
  if (contentLengthHeader) {
    const contentLength = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
      throw createRuntimeSignalError(
        'runtime fallback signal payload too large',
        'PAYLOAD_TOO_LARGE',
      );
    }
  }

  const rawBody = await c.req.raw.text();
  const payload = parseRuntimeFallbackSignalPayloadFromRawBody(
    rawBody,
    maxBodyBytes,
  );

  return {
    rawBody,
    payload,
  };
}

export function parseRuntimeFallbackSignalPayloadFromRawBody(
  rawBody: string,
  maxBodyBytes: number,
) {
  if (!rawBody || rawBody.trim().length === 0) {
    throw createRuntimeSignalError(
      'runtime fallback signal body empty',
      'INVALID_PAYLOAD',
    );
  }

  if (getUtf8ByteLength(rawBody) > maxBodyBytes) {
    throw createRuntimeSignalError(
      'runtime fallback signal payload too large',
      'PAYLOAD_TOO_LARGE',
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch (_error) {
    throw createRuntimeSignalError(
      'runtime fallback signal body must be valid JSON',
      'INVALID_PAYLOAD',
    );
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createRuntimeSignalError(
      'runtime fallback signal body must be a JSON object',
      'INVALID_PAYLOAD',
    );
  }

  return payload as Record<string, unknown>;
}
