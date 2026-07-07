// @effect-diagnostics anyUnknownInErrorContext:off asyncFunction:off globalDate:off globalTimers:off newPromise:off strictBooleanExpressions:off
import * as Layer from 'effect/Layer';
import { HttpRouter, HttpServer } from 'effect/unstable/http';
import type { HttpApi } from 'effect/unstable/httpapi';
import type { Rpc } from 'effect/unstable/rpc';

import {
  type DataBatchResponseItem,
  type DataBatchResponsePayload,
  DEFAULT_DATA_BATCH_HEADER,
  DEFAULT_DATA_ENVELOPE_HEADER,
  decodeRequestEnvelopeHeader,
} from '../../data-platform';
import {
  createBatchValidationResponse,
  isBatchRequestPayload,
  isPlainObject,
  mapWithConcurrency,
  normalizeBatchAllowedMethods,
  normalizeBatchPath,
  normalizeItemMethod,
  prepareJsonRequestBody,
  promiseWithTimeout,
  toBatchItemError,
  toHeaderRecord,
  toTextLength,
} from './batch';
import { validateDataPlatformRequestEnvelope } from './envelope';
import { createOpenApiLayer } from './openapi';
import {
  getMountedPrefixFromContext,
  getRequestPathname,
  isRpcRequest,
  removeMountedPrefixFromBatchPath,
} from './routing';
import { createRpcApiHandler, normalizeRpcPath } from './rpc';
import type {
  EffectBffOpenApiConfig,
  EffectDataPlatformValidationOptions,
  EffectRequestValidator,
  EffectRpcBffDefinition,
  EffectRuntimeLayer,
} from './types';
import { toEffectServiceContext } from './types';

export function createHttpApiHandler<
  TApi extends HttpApi.AnyWithProps = HttpApi.AnyWithProps,
  TRpcs extends Rpc.Any = Rpc.Any,
>(options: {
  api: TApi;
  layer: EffectRuntimeLayer;
  openapi?: EffectBffOpenApiConfig;
  rpc?: EffectRpcBffDefinition<TRpcs>;
  dataPlatform?: EffectDataPlatformValidationOptions;
  validateRequest?: EffectRequestValidator;
}) {
  const apiLayer = options.layer.pipe(Layer.provide(HttpServer.layerServices));
  const openApiLayer = createOpenApiLayer(options.api, options.openapi);
  const mergedLayer = openApiLayer
    ? Layer.mergeAll(apiLayer, openApiLayer)
    : apiLayer;
  const httpApiHandler = HttpRouter.toWebHandler(mergedLayer);
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

  const withDataPlatformValidation = async (
    request: Request,
    context?: Parameters<typeof httpApiHandler.handler>[1],
  ) => {
    // Policy seam first: every HttpApi request — direct or batched item —
    // passes through here, so batch fan-out cannot bypass the validator.
    const policyDenial = options.validateRequest?.(request);
    if (policyDenial) {
      return policyDenial;
    }
    const preparedRequest = await prepareJsonRequestBody(request);
    if (preparedRequest instanceof Response) {
      return preparedRequest;
    }
    const validationError = validateDataPlatformRequestEnvelope(
      preparedRequest,
      options.dataPlatform,
    );
    if (validationError) {
      return validationError;
    }
    return httpApiHandler.handler(
      preparedRequest,
      toEffectServiceContext(context),
    );
  };

  const handleBatchRequest = async (
    request: Request,
    context?: Parameters<typeof httpApiHandler.handler>[1],
  ) => {
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
    if (toTextLength(payloadText) > batchMaxBytes) {
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

        if (!normalizedHeaders.traceparent) {
          const encodedEnvelope = normalizedHeaders[normalizedEnvelopeHeader];
          if (typeof encodedEnvelope === 'string') {
            const envelope = decodeRequestEnvelopeHeader(encodedEnvelope);
            if (envelope?.traceparent) {
              normalizedHeaders.traceparent = envelope.traceparent;
            }
          }
        }

        if (!normalizedHeaders.traceparent) {
          const requestTraceparent = request.headers.get('traceparent');
          if (requestTraceparent) {
            normalizedHeaders.traceparent = requestTraceparent;
          }
        }

        const targetUrl = new URL(normalizedItemPath, request.url);
        const requestHeaders = new Headers(normalizedHeaders);
        const body =
          itemMethod === 'GET' || itemMethod === 'HEAD'
            ? undefined
            : rawItem.body;

        if (typeof body === 'undefined') {
          requestHeaders.delete('content-type');
        }

        const itemRequest = new Request(targetUrl.toString(), {
          method: itemMethod,
          headers: requestHeaders,
          body,
        });

        try {
          const itemResponse = await promiseWithTimeout(
            withDataPlatformValidation(itemRequest, context),
            batchItemTimeoutMs,
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
          if (error instanceof Response) {
            const bodyText = await error.text();
            return {
              id: itemId,
              status: error.status,
              headers: toHeaderRecord(error.headers),
              ...(bodyText ? { body: bodyText } : {}),
            } as DataBatchResponseItem;
          }

          const message =
            error instanceof Error ? error.message : String(error);
          return toBatchItemError(itemId, 500, message);
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

  const handleHttpApiRequest = async (
    request: Request,
    context?: Parameters<typeof httpApiHandler.handler>[1],
  ) => {
    const pathname = getRequestPathname(request);
    if (batchEnabled && pathname === batchPath) {
      // The outer batch POST is transport, not an API operation: each
      // batched item is dispatched through withDataPlatformValidation and
      // therefore hits the policy seam individually.
      return handleBatchRequest(request, context);
    }
    return withDataPlatformValidation(request, context);
  };

  if (!options.rpc) {
    return {
      handler: handleHttpApiRequest,
      dispose: async () => {
        await httpApiHandler.dispose();
      },
    };
  }

  const rpcPath = normalizeRpcPath(options.rpc.path);
  const rpcHandler = createRpcApiHandler(options.rpc);

  return {
    handler: async (
      request: Request,
      context?: Parameters<typeof rpcHandler.handler>[1],
    ) => {
      if (isRpcRequest(request, rpcPath)) {
        const policyDenial = options.validateRequest?.(request);
        if (policyDenial) {
          return policyDenial;
        }
        return rpcHandler.handler(request, toEffectServiceContext(context));
      }
      return handleHttpApiRequest(request);
    },
    dispose: async () => {
      await Promise.all([httpApiHandler.dispose(), rpcHandler.dispose()]);
    },
  };
}
