// @effect-diagnostics anyUnknownInErrorContext:off asyncFunction:off globalDate:off globalTimers:off newPromise:off strictBooleanExpressions:off
import type { FileSystem, Path } from 'effect';
import * as Context from 'effect/Context';
import type * as EffectType from 'effect/Effect';
import type * as Layer from 'effect/Layer';
import type { Etag, HttpPlatform, HttpRouter } from 'effect/unstable/http';
import type {
  HttpApi,
  HttpApiClient,
  HttpApiGroup,
} from 'effect/unstable/httpapi';
import type { Rpc, RpcGroup } from 'effect/unstable/rpc';

import type { createHttpApiHandler } from './http';
import type { createRpcApiHandler } from './rpc';

export type EffectRuntimeRequirements =
  | Etag.Generator
  | FileSystem.FileSystem
  | HttpPlatform.HttpPlatform
  | HttpRouter.HttpRouter
  | HttpRouter.Request<'Error', unknown>
  | HttpRouter.Request<'GlobalError', unknown>
  | HttpRouter.Request<'GlobalRequires', unknown>
  | HttpRouter.Request<'Requires', unknown>
  | Path.Path;
export type EffectRuntimeLayer = Layer.Layer<
  never,
  never,
  EffectRuntimeRequirements
>;
const emptyEffectServiceContext = Context.empty() as Context.Context<any>;

const isEffectServiceContext = (
  context: unknown,
): context is Context.Context<any> =>
  typeof context === 'object' && context !== null && 'mapUnsafe' in context;

export const toEffectServiceContext = (context: unknown) =>
  isEffectServiceContext(context) ? context : emptyEffectServiceContext;

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
  TApi extends HttpApi.Constraint = HttpApi.Top,
> =
  TApi extends HttpApi.HttpApi<infer _ApiId, infer Groups>
    ? HttpApiClient.Client<
        Extract<Groups, HttpApiGroup.Constraint>,
        never,
        never
      >
    : never;

export type EffectApiPromiseClientFromApi<
  TApi extends HttpApi.Constraint = HttpApi.Top,
> = EffectApiPromiseClient<EffectApiClientFromApi<TApi>>;

export type EffectBffDefinition<
  TApi extends HttpApi.Constraint = HttpApi.Top,
  TLayer extends EffectRuntimeLayer = EffectRuntimeLayer,
  TRpcs extends Rpc.Any = Rpc.Any,
> = {
  api: TApi;
  layer: TLayer;
  rpc?: EffectRpcBffDefinition<TRpcs>;
  dataPlatform?: EffectDataPlatformValidationOptions;
  interceptRequest?: EffectRequestInterceptor;
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

/**
 * Server-seam request validator applied to every HttpApi request — direct,
 * batched (per item) and rpc. Returning a Response short-circuits the
 * request; returning `null`/`undefined` lets it through. Used by the effect
 * adapter to enforce the cross-project policy at one seam so batched items
 * cannot bypass it.
 */
export type EffectRequestValidator = (
  request: Request,
) => Response | null | undefined;

export type EffectRequestInterceptor = (options: {
  request: Request;
  next: () => Promise<Response>;
}) => Response | Promise<Response>;

export type EffectBffHandlerFactory<
  TApi extends HttpApi.Constraint = HttpApi.Top,
  TLayer extends EffectRuntimeLayer = EffectRuntimeLayer,
> = (options?: {
  openapi?: EffectBffOpenApiConfig;
  rpc?: Partial<EffectRpcBffHandlerOptions>;
  dataPlatform?: Partial<EffectDataPlatformValidationOptions>;
  validateRequest?: EffectRequestValidator;
}) => ReturnType<typeof createHttpApiHandler>;

export type EffectBffRuntime<
  TApi extends HttpApi.Constraint = HttpApi.Top,
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
