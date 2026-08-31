// @effect-diagnostics anyUnknownInErrorContext:off asyncFunction:off globalDate:off globalTimers:off newPromise:off strictBooleanExpressions:off

import {
  type DataBatchRequestPayload,
  type DataBatchResponseItem,
  DEFAULT_DATA_BATCH_ENDPOINT,
  isPlainObject,
  measureTextBytes,
  normalizeMethod as normalizeItemMethod,
} from '../../data-platform';
import { encodeBatchText } from '../../data-platform/batch/protocol';
import { toHeaderRecord } from '../../headers';

export { toHeaderRecord } from '../../headers';

export function normalizeBatchPath(pathname: string | undefined) {
  if (!pathname || pathname === '/') {
    return DEFAULT_DATA_BATCH_ENDPOINT as `/${string}`;
  }
  if (!pathname.startsWith('/')) {
    return `/${pathname}` as `/${string}`;
  }
  return pathname as `/${string}`;
}

export function normalizeBatchAllowedMethods(
  allowedMethods: string[] | undefined,
) {
  const source =
    Array.isArray(allowedMethods) && allowedMethods.length > 0
      ? allowedMethods
      : ['GET'];
  return new Set(source.map(method => method.toUpperCase()));
}

type ParsedBatchRequestPayload = Omit<DataBatchRequestPayload, 'items'> & {
  items: unknown[];
};

export function isBatchRequestPayload(
  value: unknown,
): value is ParsedBatchRequestPayload {
  return (
    isPlainObject(value) &&
    value.protocolVersion === 2 &&
    typeof value.batchId === 'string' &&
    typeof value.sentAt === 'number' &&
    Array.isArray(value.items)
  );
}

export function createBatchValidationResponse(message: string, status = 400) {
  return new Response(
    JSON.stringify({
      message,
    }),
    {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
    },
  );
}

function cloneWithoutJsonBodyHeaders(request: Request) {
  const headers = new Headers(request.headers);
  headers.delete('content-type');
  headers.delete('content-length');

  return new Request(request.url, {
    method: request.method,
    headers,
    signal: request.signal,
  });
}

export async function prepareJsonRequestBody(request: Request) {
  const method = normalizeItemMethod(request.method);
  if (method === 'GET' || method === 'HEAD') {
    return request;
  }

  const contentType = (request.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    return request;
  }

  if (request.body === null) {
    return cloneWithoutJsonBodyHeaders(request);
  }

  try {
    const bodyText = await request.clone().text();
    if (bodyText === '') {
      return cloneWithoutJsonBodyHeaders(request);
    }

    JSON.parse(bodyText);
  } catch {
    return createBatchValidationResponse('Invalid JSON request body');
  }

  return request;
}

export function toBatchItemError(
  id: string,
  status: number,
  message: string,
): DataBatchResponseItem {
  return {
    id,
    status,
    headers: [['content-type', 'application/json; charset=utf-8']],
    body: encodeBatchText(JSON.stringify({ message })),
  };
}

export class BatchItemTimeoutError extends Error {}

export function promiseWithTimeout<T>(
  effect: Promise<T>,
  timeoutMs: number,
  onTimeout?: (error: BatchItemTimeoutError) => void,
) {
  if (timeoutMs <= 0) {
    return effect;
  }

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new BatchItemTimeoutError(
        `Batch item timeout after ${String(timeoutMs)}ms`,
      );
      onTimeout?.(error);
      reject(error);
    }, timeoutMs);

    effect.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function mapWithConcurrency<TItem, TResult>(
  items: readonly TItem[],
  concurrency: number,
  mapper: (item: TItem, index: number) => Promise<TResult>,
) {
  if (items.length === 0) {
    return [] as TResult[];
  }

  const normalizedConcurrency = Math.max(1, concurrency);
  const output = new Array<TResult>(items.length);
  let index = 0;

  const workers = Array.from(
    { length: Math.min(normalizedConcurrency, items.length) },
    async () => {
      while (true) {
        const currentIndex = index;
        index += 1;
        if (currentIndex >= items.length) {
          return;
        }
        output[currentIndex] = await mapper(items[currentIndex]!, currentIndex);
      }
    },
  );

  await Promise.all(workers);
  return output;
}
