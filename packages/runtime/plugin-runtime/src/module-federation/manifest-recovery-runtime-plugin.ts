import { wait } from '@modern-js/utils';

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 100;
const DEFAULT_TIMEOUT_MS = 1_000;
const MAX_ATTEMPTS = 5;
const MAX_RETRY_DELAY_MS = 1_000;
const MAX_TIMEOUT_MS = 5_000;

const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

const NON_RETRYABLE_ERROR_PATTERNS = [
  /RUNTIME-013/i,
  /invalid manifest/i,
  /manifest (?:schema|contract|version|identity)/i,
  /(?:incompatible|mismatch).*(?:manifest|remote)/i,
];

type ErrorLoadRemoteArgs = {
  id?: string;
  error?: unknown;
  lifecycle?: string;
};

export type ModuleFederationManifestRecoveryPluginOptions = {
  attempts?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  waitImpl?: (milliseconds: number) => Promise<void>;
};

const clampInteger = (
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) => {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === 'string' ? error : '';
};

const getErrorStatus = (error: unknown) => {
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
  ) {
    return error.status;
  }

  return undefined;
};

const isRetryableError = (error: unknown) => {
  if (error instanceof SyntaxError) {
    return false;
  }

  const message = getErrorMessage(error);

  if (NON_RETRYABLE_ERROR_PATTERNS.some(pattern => pattern.test(message))) {
    return false;
  }

  const status = getErrorStatus(error);
  if (status !== undefined) {
    return RETRYABLE_HTTP_STATUSES.has(status);
  }

  if (
    error instanceof Error &&
    ['AbortError', 'TimeoutError'].includes(error.name)
  ) {
    return true;
  }

  return (
    error instanceof TypeError ||
    /(?:fetch failed|network|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN)/i.test(
      message,
    )
  );
};

const isHttpManifestUrl = (id: string | undefined): id is string => {
  if (id === undefined || id.length === 0) {
    return false;
  }

  try {
    const url = new URL(id);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.pathname.endsWith('.json')
    );
  } catch {
    return false;
  }
};

const defaultWait = (milliseconds: number): Promise<void> =>
  wait(milliseconds).then(() => undefined);

const fetchWithTimeout = (
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
) =>
  fetchImpl(url, {
    signal: AbortSignal.timeout(timeoutMs),
  });

/**
 * Gives server-side manifest loading a small, bounded recovery window.
 *
 * Returning `undefined` deliberately hands control back to Module Federation:
 * its runtime preserves the original typed RUNTIME-003 error and invalidates
 * the rejected manifest promise. Parsed manifests are returned without schema
 * interpretation so runtime-core remains the authority for RUNTIME-013.
 */
export const createModuleFederationManifestRecoveryPlugin = (
  options: ModuleFederationManifestRecoveryPluginOptions = {},
) => {
  const attempts = clampInteger(
    options.attempts,
    DEFAULT_ATTEMPTS,
    1,
    MAX_ATTEMPTS,
  );
  const retryDelayMs = clampInteger(
    options.retryDelayMs,
    DEFAULT_RETRY_DELAY_MS,
    0,
    MAX_RETRY_DELAY_MS,
  );
  const timeoutMs = clampInteger(
    options.timeoutMs,
    DEFAULT_TIMEOUT_MS,
    1,
    MAX_TIMEOUT_MS,
  );
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const waitImpl = options.waitImpl ?? defaultWait;

  const recoverManifest = (url: string, attempt: number): Promise<unknown> => {
    const fetchManifest = () =>
      Promise.resolve()
        .then(() => fetchWithTimeout(fetchImpl, url, timeoutMs))
        .then(
          response => {
            if (!response.ok) {
              if (
                !RETRYABLE_HTTP_STATUSES.has(response.status) ||
                attempt === attempts - 1
              ) {
                return undefined;
              }

              return recoverManifest(url, attempt + 1);
            }

            return Promise.resolve()
              .then(() => response.json())
              .then(
                manifest => manifest,
                () => undefined,
              );
          },
          error => {
            if (!isRetryableError(error) || attempt === attempts - 1) {
              return undefined;
            }

            return recoverManifest(url, attempt + 1);
          },
        );

    if (attempt > 0 && retryDelayMs > 0) {
      return waitImpl(retryDelayMs).then(fetchManifest);
    }

    return fetchManifest();
  };

  return {
    name: 'modern-js-manifest-recovery-plugin',
    errorLoadRemote(args: ErrorLoadRemoteArgs) {
      if (
        args.lifecycle !== 'afterResolve' ||
        !isHttpManifestUrl(args.id) ||
        !isRetryableError(args.error) ||
        typeof fetchImpl !== 'function'
      ) {
        return Promise.resolve(undefined);
      }

      return recoverManifest(args.id, 0);
    },
  };
};

export default createModuleFederationManifestRecoveryPlugin;
