import { createHash, timingSafeEqual } from 'node:crypto';
import type { Context, ServerEnv } from '@modern-js/server-core';
import type {
  RuntimeFallbackSignalAuthConfig,
  RuntimeFallbackSignalConfig,
  RuntimeFallbackSignalSource,
  RuntimeFallbackSignalTrustContext,
  RuntimeFallbackSignalTrustPolicy,
} from './model';
import {
  createRuntimeSignalError,
  DEFAULT_RUNTIME_FALLBACK_AUTH_HEADER,
  DEFAULT_RUNTIME_FALLBACK_SIGNAL_ENDPOINT,
  DEFAULT_RUNTIME_FALLBACK_TRUST_DEDUPE_WINDOW_MS,
  DEFAULT_RUNTIME_FALLBACK_TRUST_MAX_SIGNALS_PER_WINDOW,
  DEFAULT_RUNTIME_FALLBACK_TRUST_WINDOW_MS,
  normalizeRuntimeSignalAppName,
  normalizeRuntimeSignalOrigin,
  normalizeRuntimeSignalRuntimeDigest,
} from './model';
import { cleanupRuntimeFallbackSignalRuntimeState } from './store';

export function resolveRuntimeFallbackSignalEndpoint(
  configuredEndpoint?: string,
) {
  if (typeof configuredEndpoint === 'string' && configuredEndpoint.trim()) {
    return configuredEndpoint.trim();
  }

  return DEFAULT_RUNTIME_FALLBACK_SIGNAL_ENDPOINT;
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
      '[telemetry.health.runtimeFallbackSignal] auth.enabled true but no expected token configured',
    );
  }

  return {
    enabled,
    headerName,
    expectedValue,
  };
}

/**
 * Normalizes auth config for the runtime fallback signal endpoint when the
 * endpoint itself is enabled. The endpoint records observed failing contract
 * gates, so it always requires a token.
 */
export function normalizeRequiredRuntimeFallbackSignalAuthConfig(
  configured: Parameters<typeof normalizeRuntimeFallbackSignalAuthConfig>[0],
): RuntimeFallbackSignalAuthConfig {
  if (configured?.enabled === false) {
    throw new Error(
      '[telemetry.health.runtimeFallbackSignal] auth.enabled cannot be false when runtimeFallbackSignal.enabled is true',
    );
  }

  const authConfig = normalizeRuntimeFallbackSignalAuthConfig(configured);
  if (!authConfig.expectedValue) {
    throw new Error(
      '[telemetry.health.runtimeFallbackSignal] auth.expectedValue or auth.expectedValueEnv is required when runtimeFallbackSignal.enabled is true',
    );
  }

  return {
    ...authConfig,
    enabled: true,
  };
}

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

const normalizeInteger = (
  value: unknown,
  fallback: number,
  minimum: number,
) => {
  const candidate =
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(minimum, Math.floor(candidate));
};

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
    ? configured.allowedApps
        .map(item => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
    : [];
  const allowedEntryOrigins = Array.isArray(configured?.allowedEntryOrigins)
    ? configured.allowedEntryOrigins
        .map(item => normalizeRuntimeSignalOrigin(item))
        .filter((item): item is string => Boolean(item))
    : [];

  const expectedRuntimeDigests: Record<string, string> = {};
  Object.entries(configured?.expectedRuntimeDigests || {}).forEach(
    ([appName, digest]) => {
      if (
        typeof appName === 'string' &&
        appName.trim().length > 0 &&
        typeof digest === 'string' &&
        digest.trim().length > 0
      ) {
        expectedRuntimeDigests[appName.trim()] = digest.trim();
      }
    },
  );

  return {
    allowedApps,
    allowedEntryOrigins,
    expectedRuntimeDigests,
    enforceRuntimeDigest: configured?.enforceRuntimeDigest === true,
    maxSignalsPerWindow: normalizeInteger(
      configured?.maxSignalsPerWindow,
      DEFAULT_RUNTIME_FALLBACK_TRUST_MAX_SIGNALS_PER_WINDOW,
      1,
    ),
    windowMs: normalizeInteger(
      configured?.windowMs,
      DEFAULT_RUNTIME_FALLBACK_TRUST_WINDOW_MS,
      1,
    ),
    dedupeWindowMs: normalizeInteger(
      configured?.dedupeWindowMs,
      DEFAULT_RUNTIME_FALLBACK_TRUST_DEDUPE_WINDOW_MS,
      0,
    ),
  };
}

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
        `runtime fallback signal entry origin "${
          entryOrigin || 'unknown'
        }" is not trusted`,
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
      `runtime fallback signal app "${appName}" missing runtimeDigest`,
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

  // Rate-limit on server-observed connection identity, not on
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
        `runtime fallback signal rate-limited source "${sourceKey}"`,
        'RATE_LIMITED',
      );
    }
    rateState.count += 1;
  }

  return {
    deduped: false,
  };
}
