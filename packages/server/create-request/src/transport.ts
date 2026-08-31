import type {
  DegradedModeEvent,
  RetryBackoffOptions,
  RetryDecisionContext,
  TransportResilienceOptions,
  TransportTarget,
} from './types';

const DEFAULT_RETRYABLE_STATUS_CODES = [408, 425, 429, 500, 502, 503, 504];
const DEFAULT_BASE_DELAY_MS = 100;
const DEFAULT_MAX_DELAY_MS = 1000;
const DEFAULT_JITTER_RATIO = 0.1;
const DEFAULT_RETRYABLE_METHODS = new Set([
  'DELETE',
  'GET',
  'HEAD',
  'OPTIONS',
  'PUT',
  'TRACE',
]);

type ErrorLike = {
  name?: unknown;
  code?: unknown;
  status?: unknown;
  response?: { status?: unknown };
};

const createTimeoutError = (timeoutMs: number) => {
  const error = new Error(`Request timed out after ${timeoutMs}ms`);
  error.name = 'TimeoutError';
  return error;
};

const unrefTimer = (timer: unknown) => {
  if (
    typeof timer === 'object' &&
    timer !== null &&
    'unref' in timer &&
    typeof timer.unref === 'function'
  ) {
    timer.unref();
  }
};

const wait = (ms: number) =>
  new Promise<void>(resolve => {
    const timer = setTimeout(() => resolve(), ms);
    unrefTimer(timer);
  });

const toStatusCode = (error: unknown): number | undefined => {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const status = (error as ErrorLike).status;
  if (typeof status === 'number') {
    return status;
  }

  const responseStatus = (error as ErrorLike).response?.status;
  if (typeof responseStatus === 'number') {
    return responseStatus;
  }

  return undefined;
};

const isRetryableNetworkError = (error: unknown) => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const name = (error as ErrorLike).name;
  if (
    name === 'FetchError' ||
    name === 'TimeoutError' ||
    name === 'TypeError'
  ) {
    return true;
  }

  const code = (error as ErrorLike).code;
  return (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNREFUSED' ||
    code === 'EPIPE'
  );
};

const normalizePositiveNumber = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;

const normalizeNonNegativeInt = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;

const normalizeJitterRatio = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_JITTER_RATIO;
  }
  return Math.max(0, Math.min(1, value));
};

const shouldRetryWithDefaults = (
  method: string,
  statusCode: number | undefined,
  error: unknown,
  retryableStatusCodes: number[],
) => {
  if (!DEFAULT_RETRYABLE_METHODS.has(method.toUpperCase())) {
    return false;
  }

  if (typeof statusCode === 'number') {
    return retryableStatusCodes.includes(statusCode);
  }
  return isRetryableNetworkError(error);
};

const shouldRetry = (
  retryOptions: RetryBackoffOptions | undefined,
  context: RetryDecisionContext,
  retryableStatusCodes: number[],
) => {
  if (typeof retryOptions?.shouldRetry === 'function') {
    try {
      return retryOptions.shouldRetry(context);
    } catch (error) {
      return false;
    }
  }

  return shouldRetryWithDefaults(
    context.method,
    context.statusCode,
    context.error,
    retryableStatusCodes,
  );
};

const getBackoffMs = (
  retryOptions: RetryBackoffOptions | undefined,
  attempt: number,
) => {
  const baseDelayMs = normalizePositiveNumber(
    retryOptions?.baseDelayMs,
    DEFAULT_BASE_DELAY_MS,
  );
  const maxDelayMs = normalizePositiveNumber(
    retryOptions?.maxDelayMs,
    DEFAULT_MAX_DELAY_MS,
  );
  const jitterRatio = normalizeJitterRatio(retryOptions?.jitterRatio);
  const exponentialDelay = Math.min(
    maxDelayMs,
    baseDelayMs * 2 ** Math.max(0, attempt - 1),
  );
  const jitterFactor =
    jitterRatio === 0 ? 1 : 1 + (Math.random() * 2 - 1) * jitterRatio;
  return Math.max(0, Math.floor(exponentialDelay * jitterFactor));
};

const emitDegradedEvent = (
  transport: TransportResilienceOptions | undefined,
  event: DegradedModeEvent,
) => {
  if (typeof transport?.onDegraded !== 'function') {
    return;
  }

  try {
    transport.onDegraded(event);
  } catch (error) {
    // best-effort telemetry only
  }
};

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  signalBuilder?: () => AbortController | undefined,
) => {
  if (!timeoutMs || timeoutMs <= 0) {
    const result = await promise;
    return { result };
  }

  const controller = signalBuilder?.();

  let timeoutTriggered = false;
  let rejectTimeout: ((error: Error) => void) | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    rejectTimeout = reject;
  });

  const timer = setTimeout(() => {
    timeoutTriggered = true;
    if (controller) {
      controller.abort();
    }
    rejectTimeout?.(createTimeoutError(timeoutMs));
  }, timeoutMs);
  unrefTimer(timer);

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    return { result, timeoutTriggered };
  } catch (error) {
    if (timeoutTriggered && (error as ErrorLike)?.name === 'AbortError') {
      throw createTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

type ExecuteWithResilienceOptions = {
  requestId: string;
  target: TransportTarget;
  method: string;
  url: string;
  init: Record<string, any>;
  fetcher: (...args: any[]) => Promise<any>;
  transport?: TransportResilienceOptions;
};

export const executeWithResilience = async ({
  requestId,
  target,
  method,
  url,
  init,
  fetcher,
  transport,
}: ExecuteWithResilienceOptions) => {
  const retries = normalizeNonNegativeInt(transport?.retry?.retries, 0);
  const timeoutMs =
    typeof transport?.timeoutMs === 'number' && transport.timeoutMs > 0
      ? transport.timeoutMs
      : undefined;
  const maxAttempts = retries + 1;
  const retryableStatusCodes =
    transport?.retry?.retryableStatusCodes &&
    transport.retry.retryableStatusCodes.length > 0
      ? transport.retry.retryableStatusCodes
      : DEFAULT_RETRYABLE_STATUS_CODES;

  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt += 1;
    const canUseAbortController = typeof AbortController !== 'undefined';
    let controller: AbortController | undefined;
    if (timeoutMs && canUseAbortController) {
      controller = new AbortController();
    }

    const callerSignal = init.signal as AbortSignal | undefined;
    const requestSignal = controller
      ? callerSignal && !callerSignal.aborted
        ? AbortSignal.any([callerSignal, controller.signal])
        : callerSignal || controller.signal
      : callerSignal;
    const nextInit = requestSignal ? { ...init, signal: requestSignal } : init;

    try {
      const { result } = await withTimeout(
        fetcher(url, nextInit),
        timeoutMs,
        () => controller,
      );
      return result;
    } catch (error) {
      const statusCode = toStatusCode(error);
      const decisionContext: RetryDecisionContext = {
        requestId,
        target,
        method,
        url,
        attempt,
        maxAttempts,
        error,
        statusCode,
      };

      if ((error as ErrorLike)?.name === 'TimeoutError') {
        emitDegradedEvent(transport, {
          requestId,
          target,
          method,
          url,
          reason: 'timeout',
          attempt,
          maxAttempts,
          timeoutMs,
          statusCode,
          error,
        });
      }

      const canRetry =
        attempt < maxAttempts &&
        shouldRetry(transport?.retry, decisionContext, retryableStatusCodes);
      if (!canRetry) {
        if (retries > 0 || (error as ErrorLike)?.name === 'TimeoutError') {
          emitDegradedEvent(transport, {
            requestId,
            target,
            method,
            url,
            reason: 'retry_exhausted',
            attempt,
            maxAttempts,
            timeoutMs,
            statusCode,
            error,
          });
        }
        throw error;
      }

      const backoffMs = getBackoffMs(transport?.retry, attempt);
      emitDegradedEvent(transport, {
        requestId,
        target,
        method,
        url,
        reason: 'retry',
        attempt,
        maxAttempts,
        timeoutMs,
        backoffMs,
        statusCode,
        error,
      });

      if (backoffMs > 0) {
        await wait(backoffMs);
      }
    }
  }
};
