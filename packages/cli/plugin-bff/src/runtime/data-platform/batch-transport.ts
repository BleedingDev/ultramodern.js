// @effect-diagnostics asyncFunction:off globalDate:off globalRandom:off globalTimers:off newPromise:off strictBooleanExpressions:off
import { trace } from '@opentelemetry/api';

import { isPlainObject, stableStringify } from './codec';
import type {
  DataBatchRequestItem,
  DataBatchRequestPayload,
  DataBatchResponseItem,
  DataBatchResponsePayload,
  DataBatchTransportEvent,
  DataBatchTransportOptions,
  DataBatchTransportTelemetryAttributes,
  DataTransportRequestInfo,
} from './types';
import {
  DEFAULT_DATA_BATCH_ENDPOINT,
  DEFAULT_DATA_BATCH_HEADER,
} from './types';

export const DATA_BATCH_TRANSPORT_OTEL_EVENT = 'modernjs.data.batch';

export function createDataBatchTransportTelemetryAttributes(
  event: DataBatchTransportEvent,
): DataBatchTransportTelemetryAttributes {
  return {
    'modernjs.data.batch.type': event.type,
    'modernjs.data.batch.endpoint': event.endpoint,
    'modernjs.data.batch.degraded':
      event.type === 'fallback' || event.type === 'disable',
    ...(event.batchId ? { 'modernjs.data.batch.id': event.batchId } : {}),
    ...(typeof event.size === 'number'
      ? { 'modernjs.data.batch.size': event.size }
      : {}),
    ...(event.reason ? { 'modernjs.data.batch.reason': event.reason } : {}),
  };
}

export function emitDataBatchTransportEvent(
  onEvent: ((event: DataBatchTransportEvent) => void) | undefined,
  event: DataBatchTransportEvent,
) {
  onEvent?.(event);
  trace
    .getActiveSpan()
    ?.addEvent(
      DATA_BATCH_TRANSPORT_OTEL_EVENT,
      createDataBatchTransportTelemetryAttributes(event),
    );
}

function resolveRuntimeOrigin() {
  if (
    typeof window !== 'undefined' &&
    window.location &&
    typeof window.location.origin === 'string' &&
    window.location.origin
  ) {
    return window.location.origin;
  }

  if (
    typeof globalThis !== 'undefined' &&
    (globalThis as { location?: { origin?: string } }).location &&
    typeof (globalThis as { location?: { origin?: string } }).location
      ?.origin === 'string'
  ) {
    return (globalThis as { location?: { origin?: string } }).location!.origin!;
  }

  return 'http://localhost';
}

function toAbsoluteUrl(input: DataTransportRequestInfo) {
  if (input instanceof URL) {
    return input;
  }

  if (typeof Request !== 'undefined' && input instanceof Request) {
    return new URL(input.url);
  }

  const value = String(input);
  try {
    return new URL(value);
  } catch {
    return new URL(value, resolveRuntimeOrigin());
  }
}

function normalizeBatchEndpoint(
  requestUrl: URL,
  endpoint: string | undefined,
): URL {
  const value = endpoint || DEFAULT_DATA_BATCH_ENDPOINT;
  try {
    return new URL(value);
  } catch {
    return new URL(value, requestUrl.origin);
  }
}

function toHeaderRecord(
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

function isBatchResponseItem(value: unknown): value is DataBatchResponseItem {
  return (
    isPlainObject(value) &&
    typeof value.id === 'string' &&
    typeof value.status === 'number'
  );
}

function isBatchResponsePayload(
  value: unknown,
): value is DataBatchResponsePayload {
  return (
    isPlainObject(value) &&
    value.protocolVersion === 1 &&
    typeof value.batchId === 'string' &&
    typeof value.receivedAt === 'number' &&
    Array.isArray(value.items) &&
    value.items.every(item => isBatchResponseItem(item))
  );
}

function measureTextBytes(value: string) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).length;
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.byteLength(value);
  }
  return value.length;
}

function createBatchId() {
  const now = Date.now().toString(36);
  const random = Math.random().toString(16).slice(2, 10);
  return `batch_${now}_${random}`;
}

function normalizeMethod(method: string | undefined) {
  return (method || 'GET').toUpperCase();
}

function toRequestBody(initBody: BodyInit | null | undefined) {
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

function shouldBatchRequest(input: {
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

async function parseResponseLikeCreateRequest(response: Response) {
  const contentType = response.headers.get('content-type') || '';

  if (!response.ok) {
    let data: unknown = null;
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }
    (response as Response & { data?: unknown }).data = data;
    throw response;
  }

  if (
    contentType.includes('application/json') ||
    contentType.includes('text/json')
  ) {
    return response.json();
  }

  if (contentType.includes('text/html') || contentType.includes('text/plain')) {
    return response.text();
  }

  if (
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data')
  ) {
    return response.formData();
  }

  if (contentType.includes('application/octet-stream')) {
    return response.arrayBuffer();
  }

  if (contentType.includes('image/png')) {
    return response;
  }

  return response.text();
}

type QueuedBatchRequest = {
  key: string;
  endpoint: string;
  requestUrl: string;
  requestInit: RequestInit;
  item: DataBatchRequestItem;
  size: number;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

type BatchBucket = {
  items: QueuedBatchRequest[];
  bytes: number;
  timer: ReturnType<typeof setTimeout> | null;
  flushing: boolean;
};

function ensureBucket(
  buckets: Map<string, BatchBucket>,
  endpoint: string,
): BatchBucket {
  const existing = buckets.get(endpoint);
  if (existing) {
    return existing;
  }

  const next: BatchBucket = {
    items: [],
    bytes: 0,
    timer: null,
    flushing: false,
  };
  buckets.set(endpoint, next);
  return next;
}

export function createDataBatchTransport(
  options: DataBatchTransportOptions = {},
) {
  const fallbackFetch =
    typeof fetch === 'function' ? fetch.bind(globalThis) : undefined;
  const baseFetch = options.fetch || fallbackFetch;
  if (!baseFetch) {
    throw new Error('createDataBatchTransport requires a fetch implementation');
  }
  const flushIntervalMs = Math.max(0, options.flushIntervalMs ?? 8);
  const maxBatchSize = Math.max(1, options.maxBatchSize ?? 16);
  const maxBatchBytes = Math.max(1024, options.maxBatchBytes ?? 64 * 1024);
  const requestTimeoutMs = options.requestTimeoutMs;
  const allowedMethods = new Set(
    (options.allowedMethods && options.allowedMethods.length > 0
      ? options.allowedMethods
      : ['GET']
    ).map(method => method.toUpperCase()),
  );
  const onEvent = options.onEvent;

  const buckets = new Map<string, BatchBucket>();
  const pendingByKey = new Map<string, Promise<unknown>>();
  const disabledEndpoints = new Set<string>();

  const runSingle = async (request: QueuedBatchRequest) => {
    const response = await baseFetch(request.requestUrl, request.requestInit);
    return parseResponseLikeCreateRequest(response);
  };

  const settleRequests = async (
    items: QueuedBatchRequest[],
    runner: (item: QueuedBatchRequest) => Promise<unknown>,
  ) => {
    await Promise.all(
      items.map(async item => {
        try {
          const value = await runner(item);
          item.resolve(value);
        } catch (error) {
          item.reject(error);
        } finally {
          pendingByKey.delete(item.key);
        }
      }),
    );
  };

  const flushBucket = async (endpoint: string) => {
    const bucket = buckets.get(endpoint);
    if (!bucket || bucket.flushing) {
      return;
    }

    if (bucket.timer) {
      clearTimeout(bucket.timer);
      bucket.timer = null;
    }

    if (bucket.items.length === 0) {
      return;
    }

    bucket.flushing = true;
    const items = bucket.items;
    bucket.items = [];
    bucket.bytes = 0;

    if (items.length === 1 || disabledEndpoints.has(endpoint)) {
      emitDataBatchTransportEvent(onEvent, {
        type: disabledEndpoints.has(endpoint) ? 'fallback' : 'flush',
        endpoint,
        size: items.length,
        reason: disabledEndpoints.has(endpoint) ? 'batch-disabled' : undefined,
      });
      await settleRequests(items, runSingle);
      bucket.flushing = false;
      return;
    }

    const batchId = createBatchId();
    const payload: DataBatchRequestPayload = {
      protocolVersion: 1,
      batchId,
      sentAt: Date.now(),
      items: items.map(item => item.item),
    };

    emitDataBatchTransportEvent(onEvent, {
      type: 'flush',
      endpoint,
      batchId,
      size: items.length,
    });

    const payloadJson = JSON.stringify(payload);
    const traceparent =
      items.find(item => typeof item.item.headers?.traceparent === 'string')
        ?.item.headers?.traceparent || undefined;

    const requestInit: RequestInit = {
      method: 'POST',
      headers: {
        accept: 'application/json, */*;q=0.8',
        'content-type': 'application/json; charset=utf-8',
        [DEFAULT_DATA_BATCH_HEADER]: '1',
        ...(traceparent ? { traceparent } : {}),
      },
      body: payloadJson,
    };

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    try {
      const controller =
        requestTimeoutMs && requestTimeoutMs > 0
          ? new AbortController()
          : undefined;
      if (controller) {
        requestInit.signal = controller.signal;
        timeoutHandle = setTimeout(() => {
          controller.abort();
          emitDataBatchTransportEvent(onEvent, {
            type: 'fallback',
            endpoint,
            batchId,
            size: items.length,
            reason: 'batch-timeout',
          });
        }, requestTimeoutMs);
      }

      const response = await baseFetch(endpoint, requestInit);

      if (!response.ok) {
        if (response.status === 404 || response.status === 405) {
          disabledEndpoints.add(endpoint);
          emitDataBatchTransportEvent(onEvent, {
            type: 'disable',
            endpoint,
            batchId,
            reason: `batch-endpoint-unavailable-${String(response.status)}`,
          });
        } else {
          emitDataBatchTransportEvent(onEvent, {
            type: 'fallback',
            endpoint,
            batchId,
            size: items.length,
            reason: `batch-response-${String(response.status)}`,
          });
        }
        await settleRequests(items, runSingle);
        bucket.flushing = false;
        return;
      }

      const result = (await response.json()) as unknown;
      if (!isBatchResponsePayload(result)) {
        emitDataBatchTransportEvent(onEvent, {
          type: 'fallback',
          endpoint,
          batchId,
          size: items.length,
          reason: 'invalid-batch-response',
        });
        await settleRequests(items, runSingle);
        bucket.flushing = false;
        return;
      }

      const itemMap = new Map<string, DataBatchResponseItem>();
      for (const item of result.items) {
        itemMap.set(item.id, item);
      }

      await settleRequests(items, async request => {
        const resultItem = itemMap.get(request.item.id);
        if (!resultItem) {
          return runSingle(request);
        }

        const reconstructedResponse = new Response(resultItem.body ?? '', {
          status: resultItem.status,
          headers: resultItem.headers,
        });
        return parseResponseLikeCreateRequest(reconstructedResponse);
      });
    } catch (error) {
      emitDataBatchTransportEvent(onEvent, {
        type: 'fallback',
        endpoint,
        batchId,
        size: items.length,
        reason: 'batch-transport-error',
      });
      await settleRequests(items, runSingle);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      bucket.flushing = false;
    }
  };

  return (input: DataTransportRequestInfo, init?: RequestInit) => {
    const requestUrl = toAbsoluteUrl(input);
    const batchEndpointUrl = normalizeBatchEndpoint(
      requestUrl,
      options.endpoint,
    );
    const endpoint = batchEndpointUrl.toString();
    const method = normalizeMethod(init?.method);
    const body = toRequestBody(init?.body ?? null);
    const headers = toHeaderRecord(init?.headers);

    const normalizedInit: RequestInit = {
      ...init,
      method,
      headers,
      body,
    };

    if (
      disabledEndpoints.has(endpoint) ||
      !shouldBatchRequest({
        method,
        body,
        headers,
        allowedMethods,
        batchEndpoint: endpoint,
        requestUrl,
      })
    ) {
      return baseFetch(requestUrl.toString(), normalizedInit).then(
        parseResponseLikeCreateRequest,
      );
    }

    const item: DataBatchRequestItem = {
      id: `${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`,
      path: `${requestUrl.pathname}${requestUrl.search}`,
      method,
      headers,
      ...(body ? { body } : {}),
    };

    const key = stableStringify({
      endpoint,
      path: item.path,
      method: item.method,
      headers: item.headers,
      body: item.body ?? null,
    });

    const existing = pendingByKey.get(key);
    if (existing) {
      return existing;
    }

    const size = measureTextBytes(stableStringify(item));
    const promise = new Promise<unknown>((resolve, reject) => {
      const bucket = ensureBucket(buckets, endpoint);
      const queued: QueuedBatchRequest = {
        key,
        endpoint,
        requestUrl: requestUrl.toString(),
        requestInit: normalizedInit,
        item,
        size,
        resolve,
        reject,
      };

      bucket.items.push(queued);
      bucket.bytes += size;
      emitDataBatchTransportEvent(onEvent, {
        type: 'enqueue',
        endpoint,
        size: bucket.items.length,
      });

      if (
        bucket.items.length >= maxBatchSize ||
        bucket.bytes >= maxBatchBytes
      ) {
        void flushBucket(endpoint);
        return;
      }

      if (!bucket.timer) {
        bucket.timer = setTimeout(() => {
          bucket.timer = null;
          void flushBucket(endpoint);
        }, flushIntervalMs);
      }
    });

    pendingByKey.set(key, promise);
    return promise;
  };
}
