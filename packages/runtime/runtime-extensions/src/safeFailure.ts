const SAFE_FAILURE_MESSAGES: Readonly<Record<number, string>> = {
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

const SAFE_FAILURE_CODES: Readonly<Record<number, string>> = {
  500: 'INTERNAL_SERVER_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};

export type SafeFailureEnvelope = {
  success: false;
  error: {
    code: string;
    message: string;
    status: number;
  };
};

export type SafeFailureHttpResult = {
  status: number;
  body: SafeFailureEnvelope;
  headers: Record<string, string>;
};

const readErrorProperty = (error: unknown, key: string): unknown => {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  try {
    return (error as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
};

const normalizeFailureStatus = (value: unknown): number | undefined =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 400 &&
  value <= 599
    ? value
    : undefined;

const normalizeDelaySeconds = (value: unknown): string | undefined => {
  if (typeof value === 'number') {
    const seconds = Math.ceil(value);
    return Number.isFinite(value) && value >= 0 && Number.isSafeInteger(seconds)
      ? String(seconds)
      : undefined;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+$/u.test(trimmed)) {
      return undefined;
    }
    const seconds = Number(trimmed);
    return Number.isSafeInteger(seconds) ? String(seconds) : undefined;
  }

  return undefined;
};

const normalizeHttpDate = (value: unknown): string | undefined => {
  try {
    if (value instanceof Date) {
      const timestamp = Date.prototype.getTime.call(value);
      return Number.isFinite(timestamp)
        ? new Date(timestamp).toUTCString()
        : undefined;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      const timestamp = Date.parse(trimmed);
      if (Number.isFinite(timestamp)) {
        const canonical = new Date(timestamp).toUTCString();
        return canonical === trimmed ? canonical : undefined;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
};

const normalizeRetryAfter = (value: unknown): string | undefined =>
  normalizeDelaySeconds(value) ?? normalizeHttpDate(value);

export const getSafeFailureStatus = (error: unknown): number =>
  normalizeFailureStatus(readErrorProperty(error, 'status')) ??
  normalizeFailureStatus(readErrorProperty(error, 'statusCode')) ??
  500;

export const createSafeFailureHttpResult = (
  error: unknown,
): SafeFailureHttpResult => {
  const status = getSafeFailureStatus(error);
  const retryAfterMs = readErrorProperty(error, 'retryAfterMs');
  const retryAfter =
    status === 503
      ? (normalizeRetryAfter(readErrorProperty(error, 'retryAfter')) ??
        normalizeRetryAfter(readErrorProperty(error, 'retryAfterSeconds')) ??
        normalizeRetryAfter(
          typeof retryAfterMs === 'number' ? retryAfterMs / 1000 : undefined,
        ))
      : undefined;

  return {
    status,
    body: {
      success: false,
      error: {
        code: SAFE_FAILURE_CODES[status] ?? 'REQUEST_FAILED',
        message: SAFE_FAILURE_MESSAGES[status] ?? 'Request failed',
        status,
      },
    },
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(retryAfter === undefined ? {} : { 'Retry-After': retryAfter }),
    },
  };
};

export const createSafeJsonFailureResponse = (error: unknown): Response => {
  const result = createSafeFailureHttpResult(error);
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: result.headers,
  });
};

export const createSafeFailureResponse = createSafeJsonFailureResponse;
