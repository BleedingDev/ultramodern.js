import { createHash, timingSafeEqual } from 'node:crypto';
import type { Context, ServerEnv } from '@modern-js/server-core';
import {
  CONTRACT_GATE_SNAPSHOT_SCHEMA_VERSION,
  type ContractGateSnapshotStore,
  type GateSnapshot,
} from './contractGateSnapshotStore';

export const DEFAULT_RUNTIME_FALLBACK_SIGNAL_ENDPOINT =
  '/_modern/contract-gates/runtime-fallback';
export const DEFAULT_RUNTIME_STATUS_ENDPOINT = '/_modern/runtime/status';
export const DEFAULT_RUNTIME_FALLBACK_GATE_NAME = 'runtime-mf-fallback-health';
export const DEFAULT_RUNTIME_FALLBACK_FAILURE_HOLD_MS = 5 * 60_000;
export const DEFAULT_RUNTIME_FALLBACK_MAX_BODY_BYTES = 16 * 1024;
const DEFAULT_RUNTIME_FALLBACK_AUTH_HEADER = 'x-modernjs-runtime-signal-token';
const DEFAULT_RUNTIME_FALLBACK_TRUST_MAX_SIGNALS_PER_WINDOW = 30;
const DEFAULT_RUNTIME_FALLBACK_TRUST_WINDOW_MS = 60_000;
const DEFAULT_RUNTIME_FALLBACK_TRUST_DEDUPE_WINDOW_MS = 10_000;

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

export function resolveRuntimeFallbackSignalEndpoint(
  configuredEndpoint?: string,
) {
  const rawEndpoint = configuredEndpoint?.trim();
  if (!rawEndpoint) {
    return DEFAULT_RUNTIME_FALLBACK_SIGNAL_ENDPOINT;
  }

  if (rawEndpoint.startsWith('/')) {
    return rawEndpoint;
  }

  try {
    return (
      new URL(rawEndpoint).pathname || DEFAULT_RUNTIME_FALLBACK_SIGNAL_ENDPOINT
    );
  } catch (_error) {
    return `/${rawEndpoint.replace(/^\/+/, '')}`;
  }
}

export function createRuntimeSignalError(
  message: string,
  code: RuntimeSignalError['code'],
) {
  const error = new Error(message) as RuntimeSignalError;
  error.code = code;
  return error;
}

function getUtf8ByteLength(input: string) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.byteLength(input);
  }
  return new TextEncoder().encode(input).length;
}

function normalizeRuntimeSignalOrigin(value: unknown) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  try {
    return new URL(value).origin;
  } catch (_error) {
    return undefined;
  }
}

function normalizeRuntimeSignalAppName(payload: Record<string, unknown>) {
  if (typeof payload.appName !== 'string') {
    return 'unknown';
  }
  const normalized = payload.appName.trim();
  return normalized.length > 0 ? normalized : 'unknown';
}

function normalizeRuntimeSignalRuntimeDigest(payload: Record<string, unknown>) {
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

export function normalizeRuntimeFallbackSignalAuthConfig(
  configured:
    | {
        enabled?: boolean;
        headerName?: string;
        expectedValue?: string;
        expectedValueEnv?: string;
      }
    | undefined,
): RuntimeFallbackSignalAuthConfig {
  const headerName =
    typeof configured?.headerName === 'string' && configured.headerName.trim()
      ? configured.headerName.trim().toLowerCase()
      : DEFAULT_RUNTIME_FALLBACK_AUTH_HEADER;
  const expectedFromEnv =
    typeof configured?.expectedValueEnv === 'string' &&
    configured.expectedValueEnv.trim().length > 0
      ? process.env[configured.expectedValueEnv.trim()]
      : undefined;
  const expectedFromConfig =
    typeof configured?.expectedValue === 'string' &&
    configured.expectedValue.trim().length > 0
      ? configured.expectedValue.trim()
      : undefined;
  const expectedValue = expectedFromConfig || expectedFromEnv;
  const enabled = configured?.enabled === true;

  if (enabled && !expectedValue) {
    throw new Error(
      '[telemetry.canary.autopilot.runtimeFallbackSignal] auth.enabled is true but no expected token is configured',
    );
  }

  return {
    enabled,
    headerName,
    expectedValue,
  };
}

/**
 * Normalizes the auth config for the runtime fallback signal endpoint when the
 * endpoint itself is enabled. The endpoint can persist failing contract gates
 * (a canary kill switch), so it always requires a token: auth cannot be
 * disabled and a token must be configured via `auth.expectedValue` or
 * `auth.expectedValueEnv`.
 */
export function normalizeRequiredRuntimeFallbackSignalAuthConfig(
  configured: Parameters<typeof normalizeRuntimeFallbackSignalAuthConfig>[0],
): RuntimeFallbackSignalAuthConfig {
  if (configured?.enabled === false) {
    throw new Error(
      '[telemetry.canary.autopilot.runtimeFallbackSignal] the endpoint cannot be enabled with auth disabled; configure auth.expectedValue or auth.expectedValueEnv',
    );
  }

  try {
    return normalizeRuntimeFallbackSignalAuthConfig({
      ...configured,
      enabled: true,
    });
  } catch (_error) {
    throw new Error(
      '[telemetry.canary.autopilot.runtimeFallbackSignal] enabling the endpoint requires an auth token; configure auth.expectedValue or auth.expectedValueEnv',
    );
  }
}

/**
 * Constant-time token comparison. Both sides are hashed first so neither the
 * comparison time nor the early length check leaks information about the
 * expected secret.
 */
function safeTokenEquals(candidate: string, expected: string) {
  const candidateDigest = createHash('sha256').update(candidate).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
}

export function enforceRuntimeFallbackSignalAuthToken(
  token: string | undefined,
  authConfig: RuntimeFallbackSignalAuthConfig,
) {
  if (!authConfig.enabled) {
    return;
  }

  if (
    !token ||
    !authConfig.expectedValue ||
    !safeTokenEquals(token, authConfig.expectedValue)
  ) {
    throw createRuntimeSignalError(
      'runtime fallback signal auth failed',
      'UNAUTHORIZED',
    );
  }
}

export function enforceRuntimeFallbackSignalAuth(
  c: Context<ServerEnv>,
  runtimeSignalConfig: RuntimeFallbackSignalConfig,
) {
  enforceRuntimeFallbackSignalAuthToken(
    c.req.header(runtimeSignalConfig.auth.headerName),
    runtimeSignalConfig.auth,
  );
}

export function normalizeRuntimeFallbackTrustPolicy(
  configured:
    | {
        allowedApps?: string[];
        allowedEntryOrigins?: string[];
        expectedRuntimeDigests?: Record<string, string>;
        enforceRuntimeDigest?: boolean;
        maxSignalsPerWindow?: number;
        windowMs?: number;
        dedupeWindowMs?: number;
      }
    | undefined,
): RuntimeFallbackSignalTrustPolicy {
  const allowedApps = Array.isArray(configured?.allowedApps)
    ? configured!.allowedApps
        .map(item => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
    : [];
  const allowedEntryOrigins = Array.isArray(configured?.allowedEntryOrigins)
    ? configured!.allowedEntryOrigins
        .map(item => normalizeRuntimeSignalOrigin(item))
        .filter((item): item is string => Boolean(item))
    : [];

  const expectedRuntimeDigestsRaw = configured?.expectedRuntimeDigests || {};
  const expectedRuntimeDigests: Record<string, string> = {};
  Object.entries(expectedRuntimeDigestsRaw).forEach(([appName, digest]) => {
    if (
      typeof appName === 'string' &&
      appName.trim().length > 0 &&
      typeof digest === 'string' &&
      digest.trim().length > 0
    ) {
      expectedRuntimeDigests[appName.trim()] = digest.trim();
    }
  });

  return {
    allowedApps,
    allowedEntryOrigins,
    expectedRuntimeDigests,
    enforceRuntimeDigest: configured?.enforceRuntimeDigest === true,
    maxSignalsPerWindow: Math.max(
      1,
      Math.floor(
        configured?.maxSignalsPerWindow ??
          DEFAULT_RUNTIME_FALLBACK_TRUST_MAX_SIGNALS_PER_WINDOW,
      ),
    ),
    windowMs: Math.max(
      1_000,
      Math.floor(
        configured?.windowMs ?? DEFAULT_RUNTIME_FALLBACK_TRUST_WINDOW_MS,
      ),
    ),
    dedupeWindowMs: Math.max(
      0,
      Math.floor(
        configured?.dedupeWindowMs ??
          DEFAULT_RUNTIME_FALLBACK_TRUST_DEDUPE_WINDOW_MS,
      ),
    ),
  };
}

export function createRuntimeFallbackSignalRuntimeState(): RuntimeFallbackSignalRuntimeState {
  return {
    rateLimitBySource: new Map(),
    dedupeByFingerprint: new Map(),
  };
}

function cleanupRuntimeFallbackSignalRuntimeState(
  now: number,
  runtimeState: RuntimeFallbackSignalRuntimeState,
  trustPolicy: RuntimeFallbackSignalTrustPolicy,
) {
  const dedupeExpiryMs = Math.max(
    trustPolicy.dedupeWindowMs,
    trustPolicy.windowMs,
    1_000,
  );
  runtimeState.dedupeByFingerprint.forEach((lastSeenAt, fingerprint) => {
    if (now - lastSeenAt > dedupeExpiryMs) {
      runtimeState.dedupeByFingerprint.delete(fingerprint);
    }
  });

  runtimeState.rateLimitBySource.forEach((state, source) => {
    if (now - state.windowStartedAt > trustPolicy.windowMs * 2) {
      runtimeState.rateLimitBySource.delete(source);
    }
  });
}

export type RuntimeFallbackSignalSource = {
  /**
   * Server-trusted connection identity (socket remote address). Never derive
   * this from request headers or the payload: both are attacker-controlled
   * and would let callers reset their own rate-limit budget.
   */
  remoteAddress?: string;
};

export function enforceRuntimeFallbackSignalTrustPolicy(
  payload: Record<string, unknown>,
  runtimeSignalContext: RuntimeFallbackSignalTrustContext,
  source: RuntimeFallbackSignalSource = {},
) {
  const { trustPolicy, runtimeState } = runtimeSignalContext;
  const now = Date.now();
  cleanupRuntimeFallbackSignalRuntimeState(now, runtimeState, trustPolicy);

  const appName = normalizeRuntimeSignalAppName(payload);
  const entryOrigin = normalizeRuntimeSignalOrigin(payload.entry);
  const runtimeDigest = normalizeRuntimeSignalRuntimeDigest(payload);

  if (
    trustPolicy.allowedApps.length > 0 &&
    !trustPolicy.allowedApps.includes(appName)
  ) {
    throw createRuntimeSignalError(
      `runtime fallback signal app "${appName}" is not trusted`,
      'UNTRUSTED_SOURCE',
    );
  }

  if (trustPolicy.allowedEntryOrigins.length > 0) {
    if (
      !entryOrigin ||
      !trustPolicy.allowedEntryOrigins.includes(entryOrigin)
    ) {
      throw createRuntimeSignalError(
        `runtime fallback signal entry origin "${entryOrigin || 'unknown'}" is not trusted`,
        'UNTRUSTED_SOURCE',
      );
    }
  }

  const expectedDigest = trustPolicy.expectedRuntimeDigests[appName];
  if (expectedDigest && runtimeDigest !== expectedDigest) {
    throw createRuntimeSignalError(
      `runtime fallback runtimeDigest mismatch for app "${appName}"`,
      'UNTRUSTED_SOURCE',
    );
  }

  if (trustPolicy.enforceRuntimeDigest && !runtimeDigest) {
    throw createRuntimeSignalError(
      `runtime fallback signal for app "${appName}" is missing runtimeDigest`,
      'UNTRUSTED_SOURCE',
    );
  }

  const dedupeFingerprint = JSON.stringify({
    appName,
    entryOrigin: entryOrigin || 'unknown',
    reason: payload.reason || 'runtime_fallback',
    phase: payload.phase || 'unknown',
    runtimeDigest: runtimeDigest || 'unknown',
  });
  const dedupeWindowMs = trustPolicy.dedupeWindowMs;
  if (dedupeWindowMs > 0) {
    const lastSeenAt = runtimeState.dedupeByFingerprint.get(dedupeFingerprint);
    runtimeState.dedupeByFingerprint.set(dedupeFingerprint, now);
    if (typeof lastSeenAt === 'number' && now - lastSeenAt <= dedupeWindowMs) {
      return {
        deduped: true,
      };
    }
  } else {
    runtimeState.dedupeByFingerprint.set(dedupeFingerprint, now);
  }

  // Rate-limit on the server-observed connection identity, not on
  // payload-derived values (appName/entryOrigin) that an attacker can rotate
  // to mint fresh rate-limit budgets.
  const remoteAddress = source.remoteAddress?.trim();
  const sourceKey = remoteAddress || 'unknown-remote';
  const rateState = runtimeState.rateLimitBySource.get(sourceKey);
  if (!rateState || now - rateState.windowStartedAt > trustPolicy.windowMs) {
    runtimeState.rateLimitBySource.set(sourceKey, {
      count: 1,
      windowStartedAt: now,
    });
  } else {
    if (rateState.count >= trustPolicy.maxSignalsPerWindow) {
      throw createRuntimeSignalError(
        `runtime fallback signal rate-limited for source "${sourceKey}"`,
        'RATE_LIMITED',
      );
    }
    rateState.count += 1;
  }

  return {
    deduped: false,
  };
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
      'runtime fallback signal body is empty',
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

export async function persistRuntimeFallbackContractGate(
  payload: Record<string, unknown>,
  runtimeSignalConfig: RuntimeFallbackSignalConfig,
) {
  const now = Date.now();
  const gateSnapshotStore = await runtimeSignalConfig.gateSnapshotStore;
  const snapshot: GateSnapshot = (await gateSnapshotStore.readSnapshot()) || {};
  const existingGates =
    snapshot.gates && typeof snapshot.gates === 'object' ? snapshot.gates : {};

  const reason =
    typeof payload.reason === 'string' ? payload.reason : 'runtime_fallback';
  const phase = typeof payload.phase === 'string' ? payload.phase : 'unknown';
  const appName =
    typeof payload.appName === 'string' ? payload.appName : 'unknown';
  const entry = typeof payload.entry === 'string' ? payload.entry : undefined;

  snapshot.schemaVersion =
    typeof snapshot.schemaVersion === 'number'
      ? snapshot.schemaVersion
      : CONTRACT_GATE_SNAPSHOT_SCHEMA_VERSION;
  snapshot.updatedAt = now;
  snapshot.gates = {
    ...existingGates,
    [runtimeSignalConfig.gateName]: {
      passed: false,
      reason: `runtime_fallback:${reason} phase=${phase} app=${appName}${entry ? ` entry=${entry}` : ''}`,
      updatedAt: now,
      expiresAt: now + runtimeSignalConfig.failureHoldMs,
      source: 'runtime-mf-fallback-signal',
      metadata: payload,
    },
  };

  await gateSnapshotStore.writeSnapshot(snapshot);
}
