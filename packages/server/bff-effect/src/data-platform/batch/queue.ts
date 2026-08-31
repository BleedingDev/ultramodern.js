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
import { decodeBatchBody, isNullBodyStatus } from './protocol';
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

type NormalizedBatchTransportRequest = {
  requestUrl: URL;
  endpoint: string;
  method: string;
  headers: Record<string, string>;
  credentials: RequestCredentials;
  body: BodyInit | null;
  hasOpaqueSourceBody: boolean;
  requestInput: DataTransportRequestInfo;
  requestInit: RequestInit;
  sourceSignal: AbortSignal | undefined;
};

type RequestLifetime = {
  signal: AbortSignal;
  timedOut: boolean;
  dispose: () => void;
};

type RequestSettlement =
  | { type: 'resolve'; value: unknown }
  | { type: 'reject'; reason: unknown };

type QueuedBatchRequest = {
  key: string;
  bucketKey: string;
  endpoint: string;
  requestInput: DataTransportRequestInfo;
  requestInit: RequestInit;
  authorization: string | undefined;
  cookie: string | undefined;
  credentials: RequestCredentials;
  item: DataBatchRequestItem;
  lifetime: RequestLifetime;
  phase: 'queued' | 'flushing' | 'settled';
  promise: Promise<unknown>;
  abortListener: () => void;
  abortBatchIfUnused?: () => void;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

type BatchBucket = {
  items: QueuedBatchRequest[];
  bytes: number;
  batchId: string;
  sentAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  flushing: boolean;
};

const SAFE_REPLAY_METHODS = new Set(['GET', 'HEAD']);

const abortReason = (signal: AbortSignal) =>
  signal.reason ?? new DOMException('The request was aborted', 'AbortError');

const createRequestLifetime = (
  sourceSignal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): RequestLifetime => {
  const controller = new AbortController();
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const abortFromSource = () => {
    if (sourceSignal) {
      controller.abort(abortReason(sourceSignal));
    }
  };

  if (sourceSignal?.aborted) {
    abortFromSource();
  } else if (sourceSignal) {
    sourceSignal.addEventListener('abort', abortFromSource, { once: true });
  }

  if (!controller.signal.aborted && timeoutMs && timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      controller.abort(
        new DOMException('The batched request timed out', 'TimeoutError'),
      );
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    get timedOut() {
      return timedOut;
    },
    dispose() {
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      sourceSignal?.removeEventListener('abort', abortFromSource);
    },
  };
};

const runWithSignal = <T>(
  signal: AbortSignal,
  operation: () => Promise<T>,
): Promise<T> => {
  if (signal.aborted) {
    return Promise.reject(abortReason(signal));
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(abortReason(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    let pending: Promise<T>;
    try {
      pending = operation();
    } catch (error) {
      signal.removeEventListener('abort', onAbort);
      reject(error);
      return;
    }
    pending.then(
      value => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      error => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
};

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
      batchId: createBatchId(),
      sentAt: Date.now(),
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
  const pendingByKey = new Map<string, QueuedBatchRequest>();
  const disabledEndpoints = new Set<string>();
  let nextItemId = 0;

  const createPayload = (
    bucket: Pick<BatchBucket, 'batchId' | 'sentAt'>,
    items: QueuedBatchRequest[],
  ): DataBatchRequestPayload => ({
    protocolVersion: 2,
    batchId: bucket.batchId,
    sentAt: bucket.sentAt,
    items: items.map(item => item.item),
  });

  const measurePayload = (
    bucket: Pick<BatchBucket, 'batchId' | 'sentAt'>,
    items: QueuedBatchRequest[],
  ) => measureTextBytes(JSON.stringify(createPayload(bucket, items)));

  const rotatePayloadIdentity = (bucket: BatchBucket) => {
    bucket.batchId = createBatchId();
    bucket.sentAt = Date.now();
  };

  const settleRequest = (
    request: QueuedBatchRequest,
    settlement: RequestSettlement,
  ) => {
    if (request.phase === 'settled') {
      return false;
    }

    request.phase = 'settled';
    request.lifetime.signal.removeEventListener('abort', request.abortListener);
    request.lifetime.dispose();
    if (pendingByKey.get(request.key) === request) {
      pendingByKey.delete(request.key);
    }
    if (settlement.type === 'resolve') {
      request.resolve(settlement.value);
    } else {
      request.reject(settlement.reason);
    }
    return true;
  };

  const removeQueuedRequest = (request: QueuedBatchRequest) => {
    const bucket = buckets.get(request.bucketKey);
    if (!bucket) {
      return;
    }

    const index = bucket.items.indexOf(request);
    if (index === -1) {
      return;
    }
    bucket.items.splice(index, 1);
    bucket.bytes = measurePayload(bucket, bucket.items);
    if (bucket.items.length === 0 && bucket.timer) {
      clearTimeout(bucket.timer);
      bucket.timer = null;
    }
    buckets.releaseIfIdle(request.bucketKey, bucket);
  };

  const abortQueuedRequest = (request: QueuedBatchRequest) => {
    if (request.phase === 'settled') {
      return;
    }
    if (request.phase === 'queued') {
      removeQueuedRequest(request);
    }
    const abortBatchIfUnused = request.abortBatchIfUnused;
    settleRequest(request, {
      type: 'reject',
      reason: abortReason(request.lifetime.signal),
    });
    abortBatchIfUnused?.();
  };

  const runSingle = (request: QueuedBatchRequest) => {
    return runWithSignal(request.lifetime.signal, async () => {
      const response = await baseFetch(
        request.requestInput,
        request.requestInit,
      );
      return parseResponseLikeCreateRequest(response);
    });
  };

  const settleRequests = async (
    items: QueuedBatchRequest[],
    runner: (item: QueuedBatchRequest) => Promise<unknown>,
  ) => {
    await Promise.all(
      items.map(async item => {
        if (item.phase === 'settled') {
          return;
        }
        try {
          const value = await runner(item);
          settleRequest(item, { type: 'resolve', value });
        } catch (error) {
          settleRequest(item, { type: 'reject', reason: error });
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
    for (const item of items) {
      item.phase = 'flushing';
    }
    const payloadIdentity = {
      batchId: bucket.batchId,
      sentAt: bucket.sentAt,
    };
    bucket.items = [];
    bucket.bytes = 0;
    rotatePayloadIdentity(bucket);
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

    const payload = createPayload(payloadIdentity, items);
    const batchId = payload.batchId;

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
        [DEFAULT_DATA_BATCH_HEADER]: '2',
        ...(traceparent ? { traceparent } : {}),
        ...(typeof authorization === 'string' ? { authorization } : {}),
        ...(typeof cookie === 'string' ? { cookie } : {}),
      },
      body: payloadJson,
    };

    const controller = new AbortController();
    let abortedBecauseUnused = false;
    const abortBatchIfUnused = () => {
      if (
        !controller.signal.aborted &&
        items.every(item => item.phase === 'settled')
      ) {
        abortedBecauseUnused = true;
        controller.abort(
          items.find(item => item.lifetime.timedOut)
            ? new DOMException('The batch timed out', 'TimeoutError')
            : new DOMException(
                'Every batched request was aborted',
                'AbortError',
              ),
        );
      }
    };
    for (const item of items) {
      item.abortBatchIfUnused = abortBatchIfUnused;
    }
    requestInit.signal = controller.signal;

    try {
      const response = await runWithSignal(controller.signal, () =>
        baseFetch(endpoint, requestInit),
      );

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

      const result = await runWithSignal(controller.signal, async () =>
        response.json(),
      );
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

      if (result.batchId !== batchId) {
        emitDataBatchTransportEvent(onEvent, {
          type: 'fallback',
          endpoint,
          batchId,
          size: items.length,
          reason: 'mismatched-batch-id',
        });
        await settleAmbiguousBatchRequests(items, 'mismatched-batch-id');
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

        const reconstructedBody = resultItem.body
          ? decodeBatchBody(resultItem.body)
          : null;
        const reconstructedResponse = new Response(
          isNullBodyStatus(resultItem.status) ? null : reconstructedBody,
          {
            status: resultItem.status,
            headers: resultItem.headers,
          },
        );
        return parseResponseLikeCreateRequest(reconstructedResponse);
      });
    } catch {
      if (abortedBecauseUnused) {
        if (items.some(item => item.lifetime.timedOut)) {
          emitDataBatchTransportEvent(onEvent, {
            type: 'fallback',
            endpoint,
            batchId,
            size: items.length,
            reason: 'batch-timeout',
          });
        }
        return;
      }
      emitDataBatchTransportEvent(onEvent, {
        type: 'fallback',
        endpoint,
        batchId,
        size: items.length,
        reason: 'batch-transport-error',
      });
      await settleAmbiguousBatchRequests(items, 'batch-transport-error');
    } finally {
      for (const item of items) {
        item.abortBatchIfUnused = undefined;
      }
      bucket.flushing = false;
      if (bucket.items.length > 0 && !bucket.timer) {
        void flushBucket(bucketKey);
      }
      buckets.releaseIfIdle(bucketKey, bucket);
    }
  };

  const pendingReadPromises = new Map<string, Promise<unknown>>();
  const normalizeRequest = (
    input: DataTransportRequestInfo,
    init?: RequestInit,
  ): NormalizedBatchTransportRequest => {
    const sourceRequest =
      typeof Request !== 'undefined' && input instanceof Request
        ? input
        : undefined;
    const initDefinesSignal = init !== undefined && 'signal' in init;
    const initDefinesBody = init !== undefined && 'body' in init;
    const initSnapshot = init ? { ...init } : undefined;
    const getInitValue = <Key extends keyof RequestInit>(key: Key) => {
      if (!init) {
        return undefined;
      }
      return Object.prototype.hasOwnProperty.call(initSnapshot, key)
        ? initSnapshot?.[key]
        : init[key];
    };
    const method = normalizeMethod(
      getInitValue('method') ?? sourceRequest?.method,
    );
    const headers = toHeaderRecord(
      getInitValue('headers') ?? sourceRequest?.headers,
    );
    const credentials =
      getInitValue('credentials') ??
      sourceRequest?.credentials ??
      'same-origin';
    const initBody = getInitValue('body');
    const body = initBody ?? null;
    const initSignal = initDefinesSignal ? getInitValue('signal') : undefined;
    const sourceSignal = initDefinesSignal
      ? (initSignal ?? undefined)
      : sourceRequest?.signal;
    const requestUrl = toAbsoluteUrl(input);
    const endpoint = normalizeBatchEndpoint(
      requestUrl,
      options.endpoint,
    ).toString();

    return {
      requestUrl,
      endpoint,
      method,
      headers,
      credentials,
      body,
      hasOpaqueSourceBody:
        initBody === undefined &&
        sourceRequest !== undefined &&
        sourceRequest.body !== null,
      requestInput: sourceRequest ?? requestUrl.toString(),
      requestInit: {
        ...initSnapshot,
        method,
        headers,
        credentials,
        ...(initDefinesBody ? { body: initBody } : {}),
        ...(initDefinesSignal ? { signal: initSignal } : {}),
      },
      sourceSignal,
    };
  };

  const getPendingReadKey = (request: NormalizedBatchTransportRequest) => {
    if (
      !SAFE_REPLAY_METHODS.has(request.method) ||
      request.sourceSignal !== undefined ||
      request.body !== null ||
      request.hasOpaqueSourceBody ||
      disabledEndpoints.has(request.endpoint) ||
      !shouldBatchRequest({
        method: request.method,
        body: undefined,
        headers: request.headers,
        allowedMethods,
        batchEndpoint: request.endpoint,
        requestUrl: request.requestUrl,
      })
    ) {
      return undefined;
    }

    const itemHeaders = { ...request.headers };
    delete itemHeaders.authorization;
    delete itemHeaders.cookie;
    const bucketKey = stableStringify({
      endpoint: request.endpoint,
      authorization: request.headers.authorization ?? null,
      cookie: request.headers.cookie ?? null,
      credentials: request.credentials,
    });
    return stableStringify({
      bucketKey,
      path: `${request.requestUrl.pathname}${request.requestUrl.search}`,
      method: request.method,
      headers: itemHeaders,
      body: null,
    });
  };

  const enqueue = async (request: NormalizedBatchTransportRequest) => {
    const preparedBody = await toRequestBody(request.body);
    const hasOpaqueBody =
      !preparedBody.batchable || request.hasOpaqueSourceBody;

    if (
      disabledEndpoints.has(request.endpoint) ||
      !shouldBatchRequest({
        method: request.method,
        body: hasOpaqueBody ? '[opaque request body]' : undefined,
        headers: request.headers,
        allowedMethods,
        batchEndpoint: request.endpoint,
        requestUrl: request.requestUrl,
      })
    ) {
      return baseFetch(request.requestInput, request.requestInit).then(
        parseResponseLikeCreateRequest,
      );
    }

    const itemId = `${Date.now().toString(36)}_${nextItemId.toString(36)}_${Math.random()
      .toString(16)
      .slice(2, 8)}`;
    nextItemId += 1;

    const itemHeaders = { ...request.headers };
    delete itemHeaders.authorization;
    delete itemHeaders.cookie;
    if (
      preparedBody.body &&
      preparedBody.inferredContentType &&
      !itemHeaders['content-type']
    ) {
      itemHeaders['content-type'] = preparedBody.inferredContentType;
    }
    const item: DataBatchRequestItem = {
      id: itemId,
      path: `${request.requestUrl.pathname}${request.requestUrl.search}`,
      method: request.method,
      headers: itemHeaders,
      ...(preparedBody.body ? { body: preparedBody.body } : {}),
    };

    const bucketKey = stableStringify({
      endpoint: request.endpoint,
      authorization: request.headers.authorization ?? null,
      cookie: request.headers.cookie ?? null,
      credentials: request.credentials,
    });

    const key = stableStringify({
      bucketKey,
      path: item.path,
      method: item.method,
      headers: item.headers,
      body: item.body ?? null,
    });

    const canSharePending =
      SAFE_REPLAY_METHODS.has(request.method) &&
      request.sourceSignal === undefined;
    const existing = canSharePending ? pendingByKey.get(key) : undefined;
    if (existing) {
      return existing.promise;
    }

    const lifetime = createRequestLifetime(
      request.sourceSignal,
      requestTimeoutMs,
    );
    request.requestInit.signal = lifetime.signal;
    const deferred = Promise.withResolvers<unknown>();
    const queued: QueuedBatchRequest = {
      key,
      bucketKey,
      endpoint: request.endpoint,
      requestInput: request.requestInput,
      requestInit: request.requestInit,
      authorization: request.headers.authorization,
      cookie: request.headers.cookie,
      credentials: request.credentials,
      item,
      lifetime,
      phase: 'queued',
      promise: deferred.promise,
      abortListener: () => abortQueuedRequest(queued),
      resolve: deferred.resolve,
      reject: deferred.reject,
    };
    lifetime.signal.addEventListener('abort', queued.abortListener, {
      once: true,
    });
    if (lifetime.signal.aborted) {
      abortQueuedRequest(queued);
      return queued.promise;
    }
    if (canSharePending) {
      pendingByKey.set(key, queued);
    }

    const bucket = buckets.ensure(bucketKey);

    const singletonBytes = measurePayload(bucket, [queued]);
    if (singletonBytes > maxBatchBytes) {
      emitDataBatchTransportEvent(onEvent, {
        type: 'fallback',
        endpoint: request.endpoint,
        size: 1,
        reason: 'batch-item-too-large',
      });
      queued.phase = 'flushing';
      void settleRequests([queued], runSingle);
      buckets.releaseIfIdle(bucketKey, bucket);
      return queued.promise;
    }

    const candidateItems = [...bucket.items, queued];
    const candidateBytes = measurePayload(bucket, candidateItems);
    if (bucket.items.length > 0 && candidateBytes > maxBatchBytes) {
      if (bucket.flushing) {
        emitDataBatchTransportEvent(onEvent, {
          type: 'fallback',
          endpoint: request.endpoint,
          size: 1,
          reason: 'batch-capacity-during-flush',
        });
        queued.phase = 'flushing';
        void settleRequests([queued], runSingle);
        return queued.promise;
      }
      void flushBucket(bucketKey);
      if (measurePayload(bucket, [queued]) > maxBatchBytes) {
        emitDataBatchTransportEvent(onEvent, {
          type: 'fallback',
          endpoint: request.endpoint,
          size: 1,
          reason: 'batch-item-too-large',
        });
        queued.phase = 'flushing';
        void settleRequests([queued], runSingle);
        return queued.promise;
      }
    }

    bucket.items.push(queued);
    bucket.bytes = measurePayload(bucket, bucket.items);
    emitDataBatchTransportEvent(onEvent, {
      type: 'enqueue',
      endpoint: request.endpoint,
      size: bucket.items.length,
    });

    if (bucket.items.length >= maxBatchSize || bucket.bytes >= maxBatchBytes) {
      void flushBucket(bucketKey);
      return queued.promise;
    }

    if (!bucket.timer) {
      bucket.timer = setTimeout(() => {
        bucket.timer = null;
        void flushBucket(bucketKey);
      }, flushIntervalMs);
    }
    return queued.promise;
  };

  return (input: DataTransportRequestInfo, init?: RequestInit) => {
    let request: NormalizedBatchTransportRequest;
    try {
      request = normalizeRequest(input, init);
    } catch (error) {
      return Promise.reject(error);
    }
    const pendingReadKey = getPendingReadKey(request);
    const existing = pendingReadKey
      ? pendingReadPromises.get(pendingReadKey)
      : undefined;
    if (existing) {
      return existing;
    }

    const pending = enqueue(request);
    if (pendingReadKey) {
      pendingReadPromises.set(pendingReadKey, pending);
      const clearPendingRead = () => {
        if (pendingReadPromises.get(pendingReadKey) === pending) {
          pendingReadPromises.delete(pendingReadKey);
        }
      };
      void pending.then(clearPendingRead, clearPendingRead);
    }
    return pending;
  };
}
