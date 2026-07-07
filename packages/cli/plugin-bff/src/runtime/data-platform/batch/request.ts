// @effect-diagnostics asyncFunction:off globalDate:off globalRandom:off globalTimers:off newPromise:off strictBooleanExpressions:off
import { DEFAULT_DATA_BATCH_HEADER } from '../types';

export function toHeaderRecord(
  headers: HeadersInit | undefined,
): Record<string, string> {
  if (!headers) {
    return {};
  }

  if (headers instanceof Headers) {
    const next: Record<string, string> = {};
    headers.forEach((value, key) => {
      next[key.toLowerCase()] = value;
    });
    return next;
  }

  if (Array.isArray(headers)) {
    return headers.reduce<Record<string, string>>((acc, [key, value]) => {
      acc[String(key).toLowerCase()] = String(value);
      return acc;
    }, {});
  }

  return Object.entries(headers).reduce<Record<string, string>>(
    (acc, [key, value]) => {
      if (typeof value === 'undefined') {
        return acc;
      }
      acc[String(key).toLowerCase()] = Array.isArray(value)
        ? value.join(', ')
        : String(value);
      return acc;
    },
    {},
  );
}

export function measureTextBytes(value: string) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).length;
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.byteLength(value);
  }
  return value.length;
}

export function createBatchId() {
  const now = Date.now().toString(36);
  const random = Math.random().toString(16).slice(2, 10);
  return `batch_${now}_${random}`;
}

export function normalizeMethod(method: string | undefined) {
  return (method || 'GET').toUpperCase();
}

export function toRequestBody(initBody: BodyInit | null | undefined) {
  if (typeof initBody === 'string') {
    return initBody;
  }

  if (
    typeof URLSearchParams !== 'undefined' &&
    initBody instanceof URLSearchParams
  ) {
    return initBody.toString();
  }

  return undefined;
}

export function shouldBatchRequest(input: {
  method: string;
  body: string | undefined;
  headers: Record<string, string>;
  allowedMethods: Set<string>;
  batchEndpoint: string;
  requestUrl: URL;
}) {
  if (input.requestUrl.href === input.batchEndpoint) {
    return false;
  }

  if (input.headers[DEFAULT_DATA_BATCH_HEADER] === 'off') {
    return false;
  }

  if (!input.allowedMethods.has(input.method)) {
    return false;
  }

  if (input.body !== undefined) {
    return false;
  }

  return true;
}
