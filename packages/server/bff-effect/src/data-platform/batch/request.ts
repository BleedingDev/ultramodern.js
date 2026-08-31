// @effect-diagnostics asyncFunction:off globalDate:off globalRandom:off globalTimers:off newPromise:off strictBooleanExpressions:off
import type { DataBatchBody } from '../types';
import { DEFAULT_DATA_BATCH_HEADER } from '../types';
import { encodeBatchBody } from './protocol';

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

export type PreparedBatchRequestBody = {
  body: DataBatchBody | undefined;
  inferredContentType: string | undefined;
  batchable: boolean;
};

export async function toRequestBody(
  initBody: BodyInit | null | undefined,
): Promise<PreparedBatchRequestBody> {
  if (typeof initBody === 'undefined' || initBody === null) {
    return {
      body: undefined,
      inferredContentType: undefined,
      batchable: true,
    };
  }
  if (
    typeof ReadableStream !== 'undefined' &&
    initBody instanceof ReadableStream
  ) {
    return {
      body: undefined,
      inferredContentType: undefined,
      batchable: false,
    };
  }

  try {
    const response = new Response(initBody);
    return {
      body: encodeBatchBody(new Uint8Array(await response.arrayBuffer())),
      inferredContentType: response.headers.get('content-type') || undefined,
      batchable: true,
    };
  } catch {
    return {
      body: undefined,
      inferredContentType: undefined,
      batchable: false,
    };
  }
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
