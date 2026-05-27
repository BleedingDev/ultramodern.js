// @effect-diagnostics anyUnknownInErrorContext:off asyncFunction:off globalDate:off globalTimers:off newPromise:off strictBooleanExpressions:off
import type * as EffectType from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http';
import {
  type HttpApi,
  type HttpApiClient,
  type HttpApiGroup,
  OpenApi,
} from 'effect/unstable/httpapi';
import {
  type Rpc,
  type RpcGroup,
  RpcSerialization,
  RpcServer,
} from 'effect/unstable/rpc';
import {
  type DataBatchRequestPayload,
  type DataBatchResponseItem,
  type DataBatchResponsePayload,
  DEFAULT_DATA_BATCH_ENDPOINT,
  DEFAULT_DATA_BATCH_HEADER,
  DEFAULT_DATA_ENVELOPE_HEADER,
  decodeRequestEnvelopeHeader,
  validateRequestEnvelope,
  validateSelectionPlan,
} from '../data-platform';

export * as OpenTelemetry from '@effect/opentelemetry';
export * as Config from 'effect/Config';
export * as Effect from 'effect/Effect';
export * as Layer from 'effect/Layer';
export * as Option from 'effect/Option';
export * as Schema from 'effect/Schema';
export * from 'effect/unstable/http';
export { HttpTraceContext } from 'effect/unstable/http';
export * from 'effect/unstable/httpapi';
export { HttpApiBuilder } from 'effect/unstable/httpapi';
export * from 'effect/unstable/rpc';

export type EffectRuntimeLayer = Layer.Layer<never, unknown, unknown>;
export type EffectRpcSerialization =
  | 'json'
  | 'ndjson'
  | 'jsonRpc'
  | 'ndJsonRpc'
  | 'msgPack';

export type EffectRpcRuntimeLayer<TRpcs extends Rpc.Any = Rpc.Any> =
  Layer.Layer<
    Rpc.ToHandler<TRpcs> | Rpc.Middleware<TRpcs> | Rpc.ServicesServer<TRpcs>,
    unknown,
    never
  >;

export type EffectRpcBffDefinition<
  TRpcs extends Rpc.Any = Rpc.Any,
  TRpcLayer extends EffectRpcRuntimeLayer<TRpcs> = EffectRpcRuntimeLayer<TRpcs>,
> = {
  group: RpcGroup.RpcGroup<TRpcs>;
  layer: TRpcLayer;
  path?: `/${string}`;
  serialization?: EffectRpcSerialization;
  disableTracing?: boolean;
  spanPrefix?: string;
  spanAttributes?: Record<string, unknown>;
  disableFatalDefects?: boolean;
};

export type EffectRpcBffHandlerOptions = Pick<
  EffectRpcBffDefinition,
  | 'path'
  | 'serialization'
  | 'disableTracing'
  | 'spanPrefix'
  | 'spanAttributes'
  | 'disableFatalDefects'
>;

type EffectApiPromiseClient<TClient> = {
  [GroupName in keyof TClient]: {
    [EndpointName in keyof TClient[GroupName]]: TClient[GroupName][EndpointName] extends (
      ...args: infer TArgs
    ) => infer TResult
      ? TResult extends EffectType.Effect<unknown, unknown, unknown>
        ? (
            ...args: TArgs
          ) => Promise<
            Exclude<EffectType.Success<TResult>, readonly [unknown, unknown]>
          >
        : never
      : never;
  };
};

export type EffectApiClientFromApi<
  TApi extends HttpApi.AnyWithProps = HttpApi.AnyWithProps,
> =
  TApi extends HttpApi.HttpApi<infer _ApiId, infer Groups>
    ? HttpApiClient.Client<Extract<Groups, HttpApiGroup.Any>, unknown, never>
    : never;

export type EffectApiPromiseClientFromApi<
  TApi extends HttpApi.AnyWithProps = HttpApi.AnyWithProps,
> = EffectApiPromiseClient<EffectApiClientFromApi<TApi>>;

export type EffectBffDefinition<
  TApi extends HttpApi.AnyWithProps = HttpApi.AnyWithProps,
  TLayer extends EffectRuntimeLayer = EffectRuntimeLayer,
  TRpcs extends Rpc.Any = Rpc.Any,
> = {
  api: TApi;
  layer: TLayer;
  rpc?: EffectRpcBffDefinition<TRpcs>;
  dataPlatform?: EffectDataPlatformValidationOptions;
};

export type EffectDataPlatformSelectionValidationOptions = {
  maxDepth?: number;
  maxFields?: number;
  allowedLeafPaths?: string[];
};

export type EffectDataPlatformBatchOptions = {
  /**
   * Enable network batching endpoint for Effect HttpApi requests.
   * Defaults to `true`.
   */
  enabled?: boolean;
  /**
   * Batch endpoint path mounted under BFF prefix.
   * Defaults to `/_data/batch`.
   */
  endpoint?: `/${string}`;
  /**
   * Maximum request items accepted per batch call.
   * Defaults to `16`.
   */
  maxBatchSize?: number;
  /**
   * Maximum serialized request payload size in bytes.
   * Defaults to `65536` (64KiB).
   */
  maxBatchBytes?: number;
  /**
   * Client-side micro-batch flush window in milliseconds.
   * Server runtime ignores this value and passes it through for codegen.
   * Defaults to `8`.
   */
  flushIntervalMs?: number;
  /**
   * Maximum per-batch internal request concurrency.
   * Defaults to `4`.
   */
  maxConcurrency?: number;
  /**
   * Optional timeout per internal request in milliseconds.
   * Defaults to `10000`.
   */
  requestTimeoutMs?: number;
  /**
   * Allowed HTTP methods for internal batched dispatch.
   * Defaults to `['GET']`.
   */
  allowedMethods?: string[];
};

export type EffectDataPlatformValidationOptions = {
  /**
   * Enable envelope validation for HttpApi requests.
   * Defaults to `true`.
   */
  enabled?: boolean;
  /**
   * Require every HttpApi request to include an envelope header.
   * Defaults to `false`.
   */
  requireEnvelope?: boolean;
  /**
   * Header name used by client/server for the serialized request envelope.
   * Defaults to `x-modernjs-data-envelope`.
   */
  envelopeHeader?: string;
  /**
   * Optional namespace assertion for envelope validation.
   */
  expectedNamespace?: string;
  /**
   * Validate envelope origin against incoming request origin.
   * Defaults to `true`.
   */
  validateOrigin?: boolean;
  /**
   * Require trace context inside request envelope.
   * Defaults to `false`.
   */
  requireTraceContext?: boolean;
  /**
   * Selection plan guardrails for server-side validation.
   */
  selection?: EffectDataPlatformSelectionValidationOptions;
  /**
   * Network batching gateway configuration.
   */
  batch?: EffectDataPlatformBatchOptions;
};

export type EffectBffHandlerFactory<
  TApi extends HttpApi.AnyWithProps = HttpApi.AnyWithProps,
  TLayer extends EffectRuntimeLayer = EffectRuntimeLayer,
> = (options?: {
  openapi?: EffectBffOpenApiConfig;
  rpc?: Partial<EffectRpcBffHandlerOptions>;
  dataPlatform?: Partial<EffectDataPlatformValidationOptions>;
}) => ReturnType<typeof createHttpApiHandler>;

export type EffectBffRuntime<
  TApi extends HttpApi.AnyWithProps = HttpApi.AnyWithProps,
  TLayer extends EffectRuntimeLayer = EffectRuntimeLayer,
> = {
  createHandler: EffectBffHandlerFactory<TApi, TLayer>;
  client: EffectApiPromiseClientFromApi<TApi>;
};

export type EffectBffOpenApiConfig =
  | boolean
  | {
      path?: string;
    };

export type EffectRpcBffHandlerFactory<TRpcs extends Rpc.Any = Rpc.Any> = (
  options?: Partial<EffectRpcBffHandlerOptions>,
) => ReturnType<typeof createRpcApiHandler<TRpcs>>;

function normalizeOpenApiPath(pathname: string) {
  if (!pathname.startsWith('/')) {
    return `/${pathname}` as `/${string}`;
  }
  return pathname as `/${string}`;
}

function getOpenApiOptions(openapi: EffectBffOpenApiConfig | undefined) {
  if (!openapi || typeof openapi !== 'object') {
    return undefined;
  }
  if (!openapi.path) {
    return undefined;
  }
  return {
    path: normalizeOpenApiPath(openapi.path),
  };
}

function normalizeRpcPath(pathname: string | undefined) {
  if (!pathname || pathname === '/') {
    return '/rpc' as `/${string}`;
  }
  if (!pathname.startsWith('/')) {
    return `/${pathname}` as `/${string}`;
  }
  return pathname as `/${string}`;
}

function normalizeBatchPath(pathname: string | undefined) {
  if (!pathname || pathname === '/') {
    return DEFAULT_DATA_BATCH_ENDPOINT as `/${string}`;
  }
  if (!pathname.startsWith('/')) {
    return `/${pathname}` as `/${string}`;
  }
  return pathname as `/${string}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toTextLength(value: string) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).length;
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.byteLength(value);
  }
  return value.length;
}

function toHeaderRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

function normalizeItemMethod(method: string | undefined) {
  return (method || 'GET').toUpperCase();
}

function normalizeBatchAllowedMethods(allowedMethods: string[] | undefined) {
  const source =
    Array.isArray(allowedMethods) && allowedMethods.length > 0
      ? allowedMethods
      : ['GET'];
  return new Set(source.map(method => method.toUpperCase()));
}

type ParsedBatchRequestPayload = Omit<DataBatchRequestPayload, 'items'> & {
  items: unknown[];
};

function isBatchRequestPayload(
  value: unknown,
): value is ParsedBatchRequestPayload {
  return (
    isPlainObject(value) &&
    value.protocolVersion === 1 &&
    typeof value.batchId === 'string' &&
    typeof value.sentAt === 'number' &&
    Array.isArray(value.items)
  );
}

function createBatchValidationResponse(message: string, status = 400) {
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

function toBatchItemError(
  id: string,
  status: number,
  message: string,
): DataBatchResponseItem {
  return {
    id,
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      message,
    }),
  };
}

function promiseWithTimeout<T>(effect: Promise<T>, timeoutMs: number) {
  if (timeoutMs <= 0) {
    return effect;
  }

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Batch item timeout after ${String(timeoutMs)}ms`));
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

async function mapWithConcurrency<TItem, TResult>(
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

function getRequestPathname(request: Request) {
  try {
    return new URL(request.url).pathname;
  } catch {
    return new URL(request.url, 'http://localhost').pathname;
  }
}

function normalizeMountPrefix(prefix: string) {
  if (!prefix || prefix === '/') {
    return '';
  }
  return prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
}

function getMountedPrefixFromContext(
  request: Request,
  context: unknown,
): string {
  if (!isPlainObject(context) || typeof context.path !== 'string') {
    return '';
  }

  const contextPath = normalizeMountPrefix(context.path);
  const requestPath = normalizeMountPrefix(getRequestPathname(request));

  if (
    !contextPath ||
    !requestPath ||
    contextPath === requestPath ||
    !contextPath.endsWith(requestPath)
  ) {
    return '';
  }

  return normalizeMountPrefix(
    contextPath.slice(0, contextPath.length - requestPath.length),
  );
}

function removeMountedPrefixFromBatchPath(
  pathWithQuery: string,
  prefix: string,
) {
  const normalizedPrefix = normalizeMountPrefix(prefix);
  if (!normalizedPrefix) {
    return pathWithQuery;
  }

  const [pathname, ...queryParts] = pathWithQuery.split('?');
  if (!pathname) {
    return pathWithQuery;
  }

  let nextPathname = pathname;
  if (pathname === normalizedPrefix) {
    nextPathname = '/';
  } else if (pathname.startsWith(`${normalizedPrefix}/`)) {
    const sliced = pathname.slice(normalizedPrefix.length);
    nextPathname = sliced.startsWith('/') ? sliced : `/${sliced}`;
  }

  if (queryParts.length === 0) {
    return nextPathname;
  }
  return `${nextPathname}?${queryParts.join('?')}`;
}

function getRequestOrigin(request: Request) {
  try {
    return new URL(request.url).origin;
  } catch {
    return new URL(request.url, 'http://localhost').origin;
  }
}

function getExpectedEnvelopeOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== 'null') {
    return origin;
  }
  return getRequestOrigin(request);
}

function isRpcRequest(request: Request, rpcPath: `/${string}`) {
  const pathname = getRequestPathname(request);
  return pathname === rpcPath || pathname.startsWith(`${rpcPath}/`);
}

function getRpcSerializationLayer(
  serialization: EffectRpcSerialization | undefined,
) {
  switch (serialization) {
    case 'ndjson':
      return RpcSerialization.layerNdjson;
    case 'jsonRpc':
      return RpcSerialization.layerJsonRpc();
    case 'ndJsonRpc':
      return RpcSerialization.layerNdJsonRpc();
    case 'msgPack':
      return RpcSerialization.layerMsgPack;
    default:
      return RpcSerialization.layerJsonRpc();
  }
}

function createRpcApiHandler<TRpcs extends Rpc.Any = Rpc.Any>(
  options: EffectRpcBffDefinition<TRpcs>,
) {
  const rpcPath = normalizeRpcPath(options.path);
  const rpcLayer = Layer.provide(
    RpcServer.layerHttp({
      group: options.group,
      path: rpcPath,
      protocol: 'http',
      disableTracing: options.disableTracing,
      spanPrefix: options.spanPrefix,
      spanAttributes: options.spanAttributes,
    }),
    Layer.mergeAll(
      options.layer,
      getRpcSerializationLayer(options.serialization),
    ),
  );

  return HttpRouter.toWebHandler<
    never,
    unknown,
    HttpRouter.HttpRouter,
    never,
    never
  >(rpcLayer);
}

function createOpenApiLayer(
  api: HttpApi.AnyWithProps,
  openapi: EffectBffOpenApiConfig | undefined,
) {
  const openApiOptions = getOpenApiOptions(openapi);
  if (!openApiOptions) {
    return null;
  }

  return HttpRouter.add(
    'GET',
    openApiOptions.path,
    HttpServerResponse.jsonUnsafe(OpenApi.fromApi(api)),
  );
}

function createInvalidEnvelopeResponse(message: string, errors?: string[]) {
  return new Response(
    JSON.stringify({
      message,
      ...(errors && errors.length > 0 ? { errors } : {}),
    }),
    {
      status: 400,
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
    },
  );
}

function validateDataPlatformRequestEnvelope(
  request: Request,
  options: EffectDataPlatformValidationOptions | undefined,
) {
  const isEnabled = options?.enabled ?? true;
  if (!isEnabled) {
    return null;
  }

  const envelopeHeader =
    options?.envelopeHeader || DEFAULT_DATA_ENVELOPE_HEADER;
  const encodedEnvelope = request.headers.get(envelopeHeader);

  if (!encodedEnvelope) {
    if (options?.requireEnvelope) {
      return createInvalidEnvelopeResponse(
        `Missing required data envelope header: ${envelopeHeader}`,
      );
    }
    return null;
  }

  const envelope = decodeRequestEnvelopeHeader(encodedEnvelope);
  if (!envelope) {
    return createInvalidEnvelopeResponse(
      `Invalid data envelope header format: ${envelopeHeader}`,
    );
  }

  const validation = validateRequestEnvelope(envelope, {
    expectedProtocolVersion: 1,
    expectedNamespace: options?.expectedNamespace,
    expectedOrigin:
      options?.validateOrigin === false
        ? undefined
        : getExpectedEnvelopeOrigin(request),
    requireTraceContext: options?.requireTraceContext,
  });

  if (!validation.ok) {
    return createInvalidEnvelopeResponse(
      'Invalid data envelope',
      validation.errors,
    );
  }

  if (envelope.selectionPlan) {
    const selectionValidation = validateSelectionPlan(envelope.selectionPlan, {
      maxDepth: options?.selection?.maxDepth,
      maxFields: options?.selection?.maxFields,
      allowedLeafPaths: options?.selection?.allowedLeafPaths,
    });

    if (!selectionValidation.ok) {
      return createInvalidEnvelopeResponse(
        'Invalid data envelope selection plan',
        selectionValidation.errors,
      );
    }
  }

  return null;
}

function mergeDataPlatformOptions(
  base: EffectDataPlatformValidationOptions | undefined,
  override: Partial<EffectDataPlatformValidationOptions> | undefined,
): EffectDataPlatformValidationOptions | undefined {
  if (!base && !override) {
    return undefined;
  }

  const baseSelection = base?.selection;
  const overrideSelection = override?.selection;
  const baseBatch = base?.batch;
  const overrideBatch = override?.batch;

  return {
    ...base,
    ...override,
    selection:
      baseSelection || overrideSelection
        ? {
            ...baseSelection,
            ...overrideSelection,
          }
        : undefined,
    batch:
      baseBatch || overrideBatch
        ? {
            ...baseBatch,
            ...overrideBatch,
          }
        : undefined,
  };
}

export function defineEffectBff<
  TApi extends HttpApi.AnyWithProps,
  TLayer extends EffectRuntimeLayer,
  TRpcs extends Rpc.Any = Rpc.Any,
>(definition: {
  api: TApi;
  layer: TLayer;
  rpc?: EffectRpcBffDefinition<TRpcs>;
  dataPlatform?: EffectDataPlatformValidationOptions;
}): {
  api: TApi;
  layer: TLayer;
  rpc?: EffectRpcBffDefinition<TRpcs>;
  dataPlatform?: EffectDataPlatformValidationOptions;
} & EffectBffRuntime<TApi, TLayer> {
  const createHandler: EffectBffHandlerFactory<TApi, TLayer> = options => {
    const rpcDefinition = definition.rpc;
    let mergedRpcOptions: EffectRpcBffDefinition<TRpcs> | undefined =
      rpcDefinition;
    if (rpcDefinition && options?.rpc) {
      mergedRpcOptions = {
        ...rpcDefinition,
        ...options.rpc,
      };
    }

    return createHttpApiHandler<TApi, TRpcs>({
      api: definition.api,
      layer: definition.layer,
      openapi: options?.openapi,
      rpc: mergedRpcOptions,
      dataPlatform: mergeDataPlatformOptions(
        definition.dataPlatform,
        options?.dataPlatform,
      ),
    });
  };
  const client = undefined as unknown as EffectApiPromiseClientFromApi<TApi>;
  return {
    ...definition,
    createHandler,
    client,
  };
}

export function defineEffectRpcBff<
  TRpcs extends Rpc.Any = Rpc.Any,
  TLayer extends EffectRpcRuntimeLayer<TRpcs> = EffectRpcRuntimeLayer<TRpcs>,
>(
  definition: EffectRpcBffDefinition<TRpcs, TLayer>,
): EffectRpcBffDefinition<TRpcs, TLayer> & {
  createHandler: EffectRpcBffHandlerFactory<TRpcs>;
} {
  const createHandler: EffectRpcBffHandlerFactory<TRpcs> = options =>
    createRpcApiHandler({
      ...definition,
      ...options,
    });

  return {
    ...definition,
    createHandler,
  };
}

export function createHttpApiHandler<
  TApi extends HttpApi.AnyWithProps = HttpApi.AnyWithProps,
  TRpcs extends Rpc.Any = Rpc.Any,
>(options: {
  api: TApi;
  layer: EffectRuntimeLayer;
  openapi?: EffectBffOpenApiConfig;
  rpc?: EffectRpcBffDefinition<TRpcs>;
  dataPlatform?: EffectDataPlatformValidationOptions;
}) {
  const apiLayer = options.layer;
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
    const validationError = validateDataPlatformRequestEnvelope(
      request,
      options.dataPlatform,
    );
    if (validationError) {
      return validationError;
    }
    return httpApiHandler.handler(request, context);
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
        return rpcHandler.handler(request, context);
      }
      return handleHttpApiRequest(request);
    },
    dispose: async () => {
      await Promise.all([httpApiHandler.dispose(), rpcHandler.dispose()]);
    },
  };
}
