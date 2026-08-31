// @effect-diagnostics anyUnknownInErrorContext:off asyncFunction:off globalDate:off globalTimers:off newPromise:off strictBooleanExpressions:off
import {
  type DataBatchResponseItem,
  type DataBatchResponsePayload,
  DEFAULT_DATA_BATCH_HEADER,
  DEFAULT_DATA_ENVELOPE_HEADER,
  decodeRequestEnvelopeHeader,
  isPlainObject,
  measureTextBytes,
  normalizeMethod as normalizeItemMethod,
} from '../../data-platform';
import {
  BatchItemTimeoutError,
  createBatchValidationResponse,
  isBatchRequestPayload,
  mapWithConcurrency,
  normalizeBatchAllowedMethods,
  normalizeBatchPath,
  promiseWithTimeout,
  toBatchItemError,
  toHeaderRecord,
} from './batch';
import {
  getMountedPrefixFromContext,
  removeMountedPrefixFromBatchPath,
} from './routing';
import type { EffectDataPlatformValidationOptions } from './types';

type DataPlatformBatchItemHandler<TContext> = (
  request: Request,
  context?: TContext,
) => Promise<unknown>;

const HOP_BY_HOP_BATCH_ITEM_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const OUTER_BOUND_BATCH_ITEM_HEADERS = new Set([
  'authorization',
  'cookie',
  'forwarded',
  'origin',
  'referer',
  'sec-fetch-dest',
  'sec-fetch-mode',
  'sec-fetch-site',
  'sec-fetch-user',
  'x-forwarded-client-cert',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-port',
  'x-forwarded-proto',
  'x-real-ip',
  'x-subject-id',
  'x-tenant-id',
  'x-user-id',
  'x-verified-producer',
]);

const TRANSPORT_CONTROLLED_BATCH_ITEM_HEADERS = new Set([
  'content-length',
  'host',
  ...HOP_BY_HOP_BATCH_ITEM_HEADERS,
]);

export function createDataPlatformBatchRequestHandler<TContext>(options: {
  dataPlatform?: EffectDataPlatformValidationOptions;
  handleItem: DataPlatformBatchItemHandler<TContext>;
}) {
  const dataPlatformBatchOptions = options.dataPlatform?.batch;
  const batchEnabled = dataPlatformBatchOptions?.enabled !== false;
  const batchPath = normalizeBatchPath(dataPlatformBatchOptions?.endpoint);
  const batchMaxSize = Math.max(
    1,
    dataPlatformBatchOptions?.maxBatchSize ?? 16,
  );
  const batchMaxBytes = Math.max(
    1024,
    dataPlatformBatchOptions?.maxBatchBytes ?? 64 * 1024,
  );
  const batchConcurrency = Math.max(
    1,
    dataPlatformBatchOptions?.maxConcurrency ?? 4,
  );
  const batchItemTimeoutMs = Math.max(
    0,
    dataPlatformBatchOptions?.requestTimeoutMs ?? 10_000,
  );
  const batchAllowedMethods = normalizeBatchAllowedMethods(
    dataPlatformBatchOptions?.allowedMethods,
  );
  const envelopeHeader =
    options.dataPlatform?.envelopeHeader || DEFAULT_DATA_ENVELOPE_HEADER;
  const normalizedEnvelopeHeader = envelopeHeader.toLowerCase();

  const handle = async (request: Request, context?: TContext) => {
    const mountedPrefix = getMountedPrefixFromContext(request, context);
    const method = normalizeItemMethod(request.method);
    if (method !== 'POST') {
      return createBatchValidationResponse(
        'Batch endpoint only supports POST requests',
        405,
      );
    }

    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return createBatchValidationResponse(
        'Batch endpoint requires application/json content-type',
        415,
      );
    }

    const payloadText = await request.text();
    if (measureTextBytes(payloadText) > batchMaxBytes) {
      return createBatchValidationResponse(
        `Batch payload exceeds max size (${String(batchMaxBytes)} bytes)`,
        413,
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(payloadText);
    } catch {
      return createBatchValidationResponse('Invalid batch payload JSON');
    }

    if (!isBatchRequestPayload(payload)) {
      return createBatchValidationResponse('Invalid batch payload shape');
    }

    if (payload.items.length === 0) {
      return createBatchValidationResponse(
        'Batch payload items cannot be empty',
      );
    }

    if (payload.items.length > batchMaxSize) {
      return createBatchValidationResponse(
        `Batch item count exceeds max size (${String(batchMaxSize)})`,
        413,
      );
    }

    const batchRequestOrigin = new URL(request.url).origin;
    const responseItems = await mapWithConcurrency(
      payload.items,
      batchConcurrency,
      async (rawItem, index) => {
        const fallbackId = `item_${String(index)}`;
        const itemId =
          isPlainObject(rawItem) && typeof rawItem.id === 'string'
            ? rawItem.id
            : fallbackId;

        if (!isPlainObject(rawItem)) {
          return toBatchItemError(
            itemId,
            400,
            'Invalid batch item; expected object',
          );
        }

        if (typeof rawItem.path !== 'string' || rawItem.path.length === 0) {
          return toBatchItemError(itemId, 400, 'Invalid batch item path');
        }

        if (!rawItem.path.startsWith('/')) {
          return toBatchItemError(
            itemId,
            400,
            'Batch item path must start with "/"',
          );
        }

        const normalizedItemPath = removeMountedPrefixFromBatchPath(
          rawItem.path,
          mountedPrefix,
        );
        const itemPathname =
          normalizedItemPath.split('?')[0] || normalizedItemPath;
        if (
          itemPathname === batchPath ||
          itemPathname.startsWith(`${batchPath}/`)
        ) {
          return toBatchItemError(
            itemId,
            400,
            'Batch item path cannot target batch endpoint',
          );
        }

        const itemMethod = normalizeItemMethod(
          typeof rawItem.method === 'string' ? rawItem.method : undefined,
        );
        if (!batchAllowedMethods.has(itemMethod)) {
          return toBatchItemError(
            itemId,
            405,
            `Batch item method ${itemMethod} is not allowed`,
          );
        }

        if (
          typeof rawItem.body !== 'undefined' &&
          rawItem.body !== null &&
          typeof rawItem.body !== 'string'
        ) {
          return toBatchItemError(
            itemId,
            400,
            'Batch item body must be a string when provided',
          );
        }

        if (
          (itemMethod === 'GET' || itemMethod === 'HEAD') &&
          typeof rawItem.body === 'string'
        ) {
          return toBatchItemError(
            itemId,
            400,
            `${itemMethod} batch item cannot include body`,
          );
        }

        const normalizedHeaders: Record<string, string> = {};
        if (typeof rawItem.headers !== 'undefined') {
          if (!isPlainObject(rawItem.headers)) {
            return toBatchItemError(
              itemId,
              400,
              'Batch item headers must be an object',
            );
          }

          for (const [key, value] of Object.entries(rawItem.headers)) {
            if (typeof value !== 'string') {
              return toBatchItemError(
                itemId,
                400,
                `Invalid header "${key}" for batch item`,
              );
            }
            normalizedHeaders[key.toLowerCase()] = value;
          }
        }

        const connectionScopedHeaders = new Set(
          (normalizedHeaders.connection || '')
            .split(',')
            .map(header => header.trim().toLowerCase())
            .filter(Boolean),
        );
        for (const header of Object.keys(normalizedHeaders)) {
          if (
            TRANSPORT_CONTROLLED_BATCH_ITEM_HEADERS.has(header) ||
            OUTER_BOUND_BATCH_ITEM_HEADERS.has(header) ||
            connectionScopedHeaders.has(header)
          ) {
            delete normalizedHeaders[header];
          }
        }

        if (!normalizedHeaders.traceparent) {
          const encodedEnvelope = normalizedHeaders[normalizedEnvelopeHeader];
          if (typeof encodedEnvelope === 'string') {
            const envelope = decodeRequestEnvelopeHeader(encodedEnvelope);
            if (envelope?.traceparent) {
              normalizedHeaders.traceparent = envelope.traceparent;
            }
          }
        }

        // Authentication, verified identity, and network-origin context belong
        // to the authenticated outer request. Batch items may carry application
        // and operation metadata, but cannot manufacture or replace this context.
        for (const header of OUTER_BOUND_BATCH_ITEM_HEADERS) {
          const value = request.headers.get(header);
          if (value !== null) {
            normalizedHeaders[header] = value;
          }
        }

        if (!normalizedHeaders.traceparent) {
          const requestTraceparent = request.headers.get('traceparent');
          if (requestTraceparent) {
            normalizedHeaders.traceparent = requestTraceparent;
          }
        }

        const targetUrl = new URL(normalizedItemPath, request.url);
        if (targetUrl.origin !== batchRequestOrigin) {
          return toBatchItemError(
            itemId,
            400,
            'Batch item path must stay on the same origin',
          );
        }
        let requestHeaders: Headers;
        try {
          requestHeaders = new Headers(normalizedHeaders);
        } catch {
          return toBatchItemError(itemId, 400, 'Invalid batch item headers');
        }
        const body =
          itemMethod === 'GET' || itemMethod === 'HEAD'
            ? undefined
            : rawItem.body;

        if (typeof body === 'undefined') {
          requestHeaders.delete('content-type');
        }

        const itemAbortController = new AbortController();
        const abortFromBatchRequest = () =>
          itemAbortController.abort(request.signal.reason);
        if (request.signal.aborted) {
          abortFromBatchRequest();
        } else {
          request.signal.addEventListener('abort', abortFromBatchRequest, {
            once: true,
          });
        }
        const itemRequest = new Request(targetUrl.toString(), {
          method: itemMethod,
          headers: requestHeaders,
          body,
          signal: itemAbortController.signal,
        });

        try {
          const itemResponse = await promiseWithTimeout(
            options.handleItem(itemRequest, context),
            batchItemTimeoutMs,
            error => itemAbortController.abort(error),
          );

          if (!(itemResponse instanceof Response)) {
            return toBatchItemError(
              itemId,
              500,
              'Invalid response returned by batch item handler',
            );
          }

          const bodyText = await itemResponse.text();
          const responseItem: DataBatchResponseItem = {
            id: itemId,
            status: itemResponse.status,
            headers: toHeaderRecord(itemResponse.headers),
            ...(bodyText ? { body: bodyText } : {}),
          };
          return responseItem;
        } catch (error) {
          if (error instanceof BatchItemTimeoutError) {
            console.error({
              event: 'bff.batch.item.timeout',
              batchId: payload.batchId,
              itemId,
              method: itemMethod,
              path: normalizedItemPath,
              error,
            });
            return toBatchItemError(
              itemId,
              504,
              'Batch item request timed out',
            );
          }
          if (error instanceof Response) {
            const bodyText = await error.text();
            return {
              id: itemId,
              status: error.status,
              headers: toHeaderRecord(error.headers),
              ...(bodyText ? { body: bodyText } : {}),
            } as DataBatchResponseItem;
          }

          console.error({
            event: 'bff.batch.item.failure',
            batchId: payload.batchId,
            itemId,
            method: itemMethod,
            path: normalizedItemPath,
            error,
          });
          return toBatchItemError(itemId, 500, 'Internal Server Error');
        } finally {
          request.signal.removeEventListener('abort', abortFromBatchRequest);
        }
      },
    );

    const responsePayload: DataBatchResponsePayload = {
      protocolVersion: 1,
      batchId: payload.batchId,
      receivedAt: Date.now(),
      items: responseItems,
    };

    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        [DEFAULT_DATA_BATCH_HEADER]: '1',
        'x-modernjs-data-batch-id': payload.batchId,
      },
    });
  };

  return {
    enabled: batchEnabled,
    path: batchPath,
    handle,
  };
}
