import { createHash, timingSafeEqual } from 'node:crypto';
import type { Context, ServerEnv } from '@modern-js/server-core';
import { DEFAULT_RUNTIME_FALLBACK_AUTH_HEADER } from './constants';
import { createRuntimeSignalError } from './errors';
import type {
  RuntimeFallbackSignalAuthConfig,
  RuntimeFallbackSignalConfig,
} from './types';

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
