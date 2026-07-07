import {
  DEFAULT_RUNTIME_FALLBACK_TRUST_DEDUPE_WINDOW_MS,
  DEFAULT_RUNTIME_FALLBACK_TRUST_MAX_SIGNALS_PER_WINDOW,
  DEFAULT_RUNTIME_FALLBACK_TRUST_WINDOW_MS,
} from './constants';
import { createRuntimeSignalError } from './errors';
import {
  normalizeRuntimeSignalAppName,
  normalizeRuntimeSignalOrigin,
  normalizeRuntimeSignalRuntimeDigest,
} from './source';
import { cleanupRuntimeFallbackSignalRuntimeState } from './state';
import type {
  RuntimeFallbackSignalConfig,
  RuntimeFallbackSignalSource,
  RuntimeFallbackSignalTrustContext,
  RuntimeFallbackSignalTrustPolicy,
} from './types';

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
