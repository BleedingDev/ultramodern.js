// @effect-diagnostics asyncFunction:off globalDate:off globalRandom:off globalTimers:off newPromise:off strictBooleanExpressions:off
import { stableStringify } from '../codec';
import type {
  DataBatchRequestItem,
  DataBatchRequestPayload,
  DataBatchResponseItem,
  DataBatchTransportOptions,
  DataTransportRequestInfo,
} from '../types';
import { DEFAULT_DATA_BATCH_HEADER } from '../types';
import {
  createBatchId,
  measureTextBytes,
  normalizeMethod,
  shouldBatchRequest,
  toHeaderRecord,
  toRequestBody,
} from './request';
import {
  isBatchResponsePayload,
  parseResponseLikeCreateRequest,
} from './response';
import { emitDataBatchTransportEvent } from './telemetry';
import { normalizeBatchEndpoint, toAbsoluteUrl } from './url';

type DataBatchFetch = NonNullable<DataBatchTransportOptions['fetch']>;

type CreateBatchTransportQueueOptions = {
  options: DataBatchTransportOptions;
  baseFetch: DataBatchFetch;
};

export type QueuedBatchRequest = {
  key: string;
  endpoint: string;
  requestUrl: string;
  requestInit: RequestInit;
  item: DataBatchRequestItem;
  size: number;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

export type BatchBucket = {
  items: QueuedBatchRequest[];
  bytes: number;
  timer: ReturnType<typeof setTimeout> | null;
  flushing: boolean;
};

export function ensureBucket(
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

export function createBatchTransportQueue({
  options,
  baseFetch,
}: CreateBatchTransportQueueOptions) {
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
  let nextItemId = 0;

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
      if (bucket.items.length > 0 && !bucket.timer) {
        void flushBucket(endpoint);
      }
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
      if (bucket.items.length > 0 && !bucket.timer) {
        void flushBucket(endpoint);
      }
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

    const itemId = `${Date.now().toString(36)}_${nextItemId.toString(36)}_${Math.random()
      .toString(16)
      .slice(2, 8)}`;
    nextItemId += 1;

    const item: DataBatchRequestItem = {
      id: itemId,
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
