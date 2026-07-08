const SAFE_FAILURE_MESSAGES: Record<number, string> = {
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

const SAFE_FAILURE_CODES: Record<number, string> = {
  500: 'INTERNAL_SERVER_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};

const INVALID_HTTP_HEADER_VALUE = /[\0-\x08\x0a-\x1f\x7f]/u;

type SafeFailureEnvelope = {
  success: false;
  error: {
    code: string;
    message: string;
    status: number;
  };
};

const readErrorProperty = (error: unknown, key: string): unknown => {
  if (typeof error !== 'object' || error === null || !(key in error)) {
    return undefined;
  }
  return (error as Record<string, unknown>)[key];
};

const normalizeFailureStatus = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return undefined;
  }
  return value >= 400 && value <= 599 ? value : undefined;
};

const normalizeRetryAfter = (value: unknown): string | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return String(Math.ceil(value));
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 && !INVALID_HTTP_HEADER_VALUE.test(trimmed)
      ? trimmed
      : undefined;
  }
  if (value instanceof Date) {
    return value.toUTCString();
  }
  return undefined;
};

export const createSafeFailureResponse = (error: unknown): Response => {
  const status =
    normalizeFailureStatus(readErrorProperty(error, 'status')) ??
    normalizeFailureStatus(readErrorProperty(error, 'statusCode')) ??
    500;
  const retryAfter =
    status === 503
      ? (normalizeRetryAfter(readErrorProperty(error, 'retryAfter')) ??
        normalizeRetryAfter(readErrorProperty(error, 'retryAfterSeconds')) ??
        normalizeRetryAfter(
          typeof readErrorProperty(error, 'retryAfterMs') === 'number'
            ? (readErrorProperty(error, 'retryAfterMs') as number) / 1000
            : undefined,
        ))
      : undefined;
  const body: SafeFailureEnvelope = {
    success: false,
    error: {
      code: SAFE_FAILURE_CODES[status] ?? 'REQUEST_FAILED',
      message: SAFE_FAILURE_MESSAGES[status] ?? 'Request failed',
      status,
    },
  };
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
  };
  if (retryAfter !== undefined) {
    headers['Retry-After'] = retryAfter;
  }

  return new Response(JSON.stringify(body), {
    status,
    headers,
  });
};
