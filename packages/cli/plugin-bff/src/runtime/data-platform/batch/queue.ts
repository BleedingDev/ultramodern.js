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
  bucketRegistry?: BatchBucketRegistry;
};

type QueuedBatchRequest = {
  key: string;
  endpoint: string;
  requestInput: DataTransportRequestInfo;
  requestInit: RequestInit;
  authorization: string | undefined;
  cookie: string | undefined;
  credentials: RequestCredentials;
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

const SAFE_REPLAY_METHODS = new Set(['GET', 'HEAD']);

export class BatchBucketRegistry {
  private readonly buckets = new Map<string, BatchBucket>();

  get size() {
    return this.buckets.size;
  }

  get(bucketKey: string) {
    return this.buckets.get(bucketKey);
  }

  ensure(bucketKey: string) {
    const existing = this.buckets.get(bucketKey);
    if (existing) {
      return existing;
    }

    const next: BatchBucket = {
      items: [],
      bytes: 0,
      timer: null,
      flushing: false,
    };
    this.buckets.set(bucketKey, next);
    return next;
  }

  releaseIfIdle(bucketKey: string, bucket: BatchBucket) {
    if (
      this.buckets.get(bucketKey) !== bucket ||
      bucket.flushing ||
      bucket.timer !== null ||
      bucket.items.length > 0
    ) {
      return false;
    }

    return this.buckets.delete(bucketKey);
  }
}

export function createBatchTransportQueue({
  options,
  baseFetch,
  bucketRegistry,
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

  const buckets = bucketRegistry ?? new BatchBucketRegistry();
  const pendingByKey = new Map<string, Promise<unknown>>();
  const disabledEndpoints = new Set<string>();
  let nextItemId = 0;

  const runSingle = async (request: QueuedBatchRequest) => {
    const response = await baseFetch(request.requestInput, request.requestInit);
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

  const runAfterAmbiguousBatch = (
    request: QueuedBatchRequest,
    reason: string,
  ) => {
    if (!SAFE_REPLAY_METHODS.has(request.item.method)) {
      throw new Error(
        `Batch result is unknown for ${request.item.method}; automatic replay is disabled (${reason}).`,
      );
    }
    return runSingle(request);
  };

  const settleAmbiguousBatchRequests = (
    items: QueuedBatchRequest[],
    reason: string,
  ) =>
    settleRequests(items, request => runAfterAmbiguousBatch(request, reason));

  const flushBucket = async (bucketKey: string) => {
    const bucket = buckets.get(bucketKey);
    if (!bucket || bucket.flushing) {
      return;
    }

    if (bucket.timer) {
      clearTimeout(bucket.timer);
      bucket.timer = null;
    }

    if (bucket.items.length === 0) {
      buckets.releaseIfIdle(bucketKey, bucket);
      return;
    }

    bucket.flushing = true;
    const items = bucket.items;
    bucket.items = [];
    bucket.bytes = 0;
    const firstItem = items[0];
    if (!firstItem) {
      bucket.flushing = false;
      buckets.releaseIfIdle(bucketKey, bucket);
      return;
    }
    const endpoint = firstItem.endpoint;

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
        void flushBucket(bucketKey);
      }
      buckets.releaseIfIdle(bucketKey, bucket);
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
    const authorization = firstItem.authorization;
    const cookie = firstItem.cookie;

    const requestInit: RequestInit = {
      method: 'POST',
      credentials: firstItem.credentials,
      headers: {
        accept: 'application/json, */*;q=0.8',
        'content-type': 'application/json; charset=utf-8',
        [DEFAULT_DATA_BATCH_HEADER]: '1',
        ...(traceparent ? { traceparent } : {}),
        ...(typeof authorization === 'string' ? { authorization } : {}),
        ...(typeof cookie === 'string' ? { cookie } : {}),
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
        await settleAmbiguousBatchRequests(
          items,
          `batch-response-${String(response.status)}`,
        );
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
        await settleAmbiguousBatchRequests(items, 'invalid-batch-response');
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
          return runAfterAmbiguousBatch(request, 'missing-batch-result');
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
      await settleAmbiguousBatchRequests(items, 'batch-transport-error');
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      bucket.flushing = false;
      if (bucket.items.length > 0 && !bucket.timer) {
        void flushBucket(bucketKey);
      }
      buckets.releaseIfIdle(bucketKey, bucket);
    }
  };

  return (input: DataTransportRequestInfo, init?: RequestInit) => {
    const sourceRequest =
      typeof Request !== 'undefined' && input instanceof Request
        ? input
        : undefined;
    const requestUrl = toAbsoluteUrl(input);
    const batchEndpointUrl = normalizeBatchEndpoint(
      requestUrl,
      options.endpoint,
    );
    const endpoint = batchEndpointUrl.toString();
    const method = normalizeMethod(init?.method ?? sourceRequest?.method);
    const body = toRequestBody(init?.body ?? null);
    const headers = toHeaderRecord(init?.headers ?? sourceRequest?.headers);
    const credentials =
      init?.credentials ?? sourceRequest?.credentials ?? 'same-origin';
    const hasOpaqueBody =
      (typeof init?.body !== 'undefined' &&
        init.body !== null &&
        typeof body === 'undefined') ||
      (typeof init?.body === 'undefined' &&
        sourceRequest !== undefined &&
        sourceRequest.body !== null);

    const normalizedInit: RequestInit = {
      ...init,
      method,
      headers,
      credentials,
      ...(typeof body === 'string' ? { body } : {}),
    };
    const requestInput = sourceRequest ?? requestUrl.toString();

    if (
      disabledEndpoints.has(endpoint) ||
      !shouldBatchRequest({
        method,
        body: hasOpaqueBody ? '[opaque request body]' : body,
        headers,
        allowedMethods,
        batchEndpoint: endpoint,
        requestUrl,
      })
    ) {
      return baseFetch(requestInput, normalizedInit).then(
        parseResponseLikeCreateRequest,
      );
    }

    const itemId = `${Date.now().toString(36)}_${nextItemId.toString(36)}_${Math.random()
      .toString(16)
      .slice(2, 8)}`;
    nextItemId += 1;

    const itemHeaders = { ...headers };
    delete itemHeaders.authorization;
    delete itemHeaders.cookie;
    const item: DataBatchRequestItem = {
      id: itemId,
      path: `${requestUrl.pathname}${requestUrl.search}`,
      method,
      headers: itemHeaders,
      ...(typeof body === 'string' ? { body } : {}),
    };

    const bucketKey = stableStringify({
      endpoint,
      authorization: headers.authorization ?? null,
      cookie: headers.cookie ?? null,
      credentials,
    });

    const key = stableStringify({
      bucketKey,
      path: item.path,
      method: item.method,
      headers: item.headers,
      body: item.body ?? null,
    });

    const canSharePending = SAFE_REPLAY_METHODS.has(method);
    const existing = canSharePending ? pendingByKey.get(key) : undefined;
    if (existing) {
      return existing;
    }

    const size = measureTextBytes(stableStringify(item));
    const promise = new Promise<unknown>((resolve, reject) => {
      const bucket = buckets.ensure(bucketKey);
      const queued: QueuedBatchRequest = {
        key,
        endpoint,
        requestInput,
        requestInit: normalizedInit,
        authorization: headers.authorization,
        cookie: headers.cookie,
        credentials,
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
        void flushBucket(bucketKey);
        return;
      }

      if (!bucket.timer) {
        bucket.timer = setTimeout(() => {
          bucket.timer = null;
          void flushBucket(bucketKey);
        }, flushIntervalMs);
      }
    });

    if (canSharePending) {
      pendingByKey.set(key, promise);
    }
    return promise;
  };
}
