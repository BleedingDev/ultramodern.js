// @effect-diagnostics anyUnknownInErrorContext:off asyncFunction:off strictBooleanExpressions:off
import {
  evaluateCrossProjectPolicy,
  type NormalizedCrossProjectPolicy,
  resolveCrossProjectRequestObservation,
} from '@modern-js/bff-core/security/cross-project-policy';
import { toHeaderRecord } from '../headers';
import {
  type DispatchEffectBffRequestOptions,
  dispatchEffectBffRequestWithContext,
} from './dispatch';
import { runWithEffectContext } from './edge-context';
import type {
  EffectBffOpenApiConfig,
  EffectDataPlatformValidationOptions,
} from './handler';
import {
  type EffectApiModule,
  type EffectBffRequestHandler,
  resolveEffectBffModuleHandler,
} from './module';
import type { EffectContext } from './operation-context';

export * as Config from 'effect/Config';
export * as Effect from 'effect/Effect';
export * as Layer from 'effect/Layer';
export * as Option from 'effect/Option';
export * as Schema from 'effect/Schema';
export {
  Cookies,
  Etag,
  FetchHttpClient,
  FindMyWay,
  Headers,
  HttpBody,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
  HttpEffect,
  HttpIncomingMessage,
  HttpMethod,
  HttpMiddleware,
  HttpPlatform,
  HttpRouter,
  HttpServer,
  HttpServerError,
  HttpServerRequest,
  HttpServerRespondable,
  HttpServerResponse,
  HttpStaticServer,
  HttpStatus,
  HttpTraceContext,
  Multipart,
  MultipartParser,
  Template,
  Url,
  UrlParams,
} from 'effect/unstable/http';
export {
  HttpApi,
  HttpApiBuilder,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
  HttpApiSecurity,
  HttpApiTest,
  OpenApi,
} from 'effect/unstable/httpapi';
export {
  Rpc,
  RpcClient,
  RpcClientError,
  RpcGroup,
  RpcMessage,
  RpcMiddleware,
  RpcSchema,
  RpcSerialization,
  RpcServer,
  RpcTest,
  RpcWorker,
  Utils,
} from 'effect/unstable/rpc';
export {
  runWithEffectContext,
  useEffectContext,
  useOperationContext,
} from './edge-context';
export type {
  EffectApiClientFromApi,
  EffectApiPromiseClientFromApi,
  EffectBffDefinition,
  EffectBffHandlerFactory,
  EffectBffOpenApiConfig,
  EffectBffRuntime,
  EffectDataPlatformBatchOptions,
  EffectDataPlatformSelectionValidationOptions,
  EffectDataPlatformValidationOptions,
  EffectRequestValidator,
  EffectRpcBffDefinition,
  EffectRpcBffHandlerFactory,
  EffectRpcBffHandlerOptions,
  EffectRpcRuntimeLayer,
  EffectRpcSerialization,
  EffectRuntimeLayer,
  EffectRuntimeRequirements,
} from './handler';
export {
  createHttpApiHandler,
  defineEffectBff,
  defineEffectRpcBff,
} from './handler';
export {
  type CreateEffectOperationContextOptions,
  createEffectOperationContext,
  type EffectContext,
} from './operation-context';

export type EffectBffEdgeDispatchOptions = Omit<
  DispatchEffectBffRequestOptions,
  'runWithEffectContext'
>;

export type EffectBffEdgeHandlerOptions = {
  module: EffectApiModule;
  prefix?: string;
  openapi?: EffectBffOpenApiConfig;
  dataPlatform?: EffectDataPlatformValidationOptions;
  crossProjectPolicy?: NormalizedCrossProjectPolicy;
  onError?: (
    error: unknown,
    context: EffectContext,
  ) => Promise<Response> | Response;
  onWarning?: (message: string) => void;
};

const NORMALIZED_POLICY_BOOLEAN_FIELDS = [
  'enabled',
  'requireEnvelope',
  'requireOperationContext',
  'requireOperationContextDetails',
  'requireOperationSchemaHash',
  'requireOperationVersion',
  'allowUnknownOperations',
] as const;

function assertNormalizedCrossProjectPolicy(
  policy: NormalizedCrossProjectPolicy | undefined,
) {
  if (policy === undefined) {
    return;
  }
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    throw new Error(
      '[BFF][Effect] Edge cross-project policy must be a normalized object.',
    );
  }
  for (const field of NORMALIZED_POLICY_BOOLEAN_FIELDS) {
    if (typeof policy[field] !== 'boolean') {
      throw new Error(
        `[BFF][Effect] Edge cross-project policy requires boolean ${field}.`,
      );
    }
  }
  if (
    !policy.expectedOperationContracts ||
    typeof policy.expectedOperationContracts !== 'object' ||
    Array.isArray(policy.expectedOperationContracts)
  ) {
    throw new Error(
      '[BFF][Effect] Edge cross-project policy requires expectedOperationContracts object.',
    );
  }
}

function restoreEffectBffMountPath(
  request: Request,
  prefix: string | undefined,
) {
  const pathname = new URL(request.url).pathname;
  if (!prefix || prefix === '/') {
    return pathname;
  }
  const normalizedPrefix = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  return pathname === '/' ? normalizedPrefix : `${normalizedPrefix}${pathname}`;
}

export async function dispatchEffectBffRequest(
  handler: EffectBffRequestHandler,
  request: Request,
  options: EffectBffEdgeDispatchOptions = {},
): Promise<Response> {
  return dispatchEffectBffRequestWithContext(handler, request, {
    ...options,
    runWithEffectContext,
  });
}

export async function createEffectBffEdgeDispatcher(
  options: EffectBffEdgeHandlerOptions,
) {
  const crossProjectPolicy = options.crossProjectPolicy;
  assertNormalizedCrossProjectPolicy(crossProjectPolicy);
  const loaded = await resolveEffectBffModuleHandler(options.module, {
    openapi: options.openapi,
    dataPlatform: options.dataPlatform,
    validateRequest:
      crossProjectPolicy?.enabled === true
        ? request => {
            const pathname = new URL(request.url).pathname;
            const observedRequest = resolveCrossProjectRequestObservation(
              { method: request.method, pathname },
              crossProjectPolicy,
            ) ?? {
              method: request.method,
              routePath: restoreEffectBffMountPath(request, options.prefix),
            };
            const violation = evaluateCrossProjectPolicy(
              toHeaderRecord(request.headers),
              crossProjectPolicy,
              observedRequest,
            );
            if (!violation) {
              return null;
            }
            return new Response(
              JSON.stringify({
                code: violation.code,
                reason: violation.reason,
                message: violation.message,
              }),
              {
                status: violation.status,
                headers: {
                  'content-type': 'application/json; charset=utf-8',
                },
              },
            );
          }
        : undefined,
    onWarning: options.onWarning,
  });
  if (!loaded) {
    throw new Error(
      '[BFF][Effect] Invalid Effect edge module. Export defineEffectBff(...) or a { api, layer } HttpApi module.',
    );
  }

  const retiredError = new Error(
    '[BFF][Effect] Edge dispatcher is disposing or has been disposed.',
  );
  let acceptingRequests = true;
  let activeDispatches = 0;
  let resolveDrain: (() => void) | undefined;
  let disposePromise: Promise<void> | undefined;

  return {
    dispatch: (
      request: Request,
      dispatchOptions: Omit<
        EffectBffEdgeDispatchOptions,
        'prefix' | 'onError'
      > = {},
    ) => {
      if (!acceptingRequests) {
        return Promise.reject(retiredError);
      }
      activeDispatches += 1;
      return dispatchEffectBffRequest(loaded.handler, request, {
        ...dispatchOptions,
        prefix: options.prefix,
        onError: options.onError,
      }).finally(() => {
        activeDispatches -= 1;
        if (activeDispatches === 0) {
          resolveDrain?.();
          resolveDrain = undefined;
        }
      });
    },
    dispose: () => {
      disposePromise ??= (async () => {
        acceptingRequests = false;
        if (activeDispatches > 0) {
          await new Promise<void>(resolve => {
            resolveDrain = resolve;
          });
        }
        await loaded.dispose?.();
      })();
      return disposePromise;
    },
  };
}

export const createEffectBffTestHandler = createEffectBffEdgeHandler;

export async function createEffectBffEdgeHandler(
  options: EffectBffEdgeHandlerOptions,
) {
  const dispatcher = await createEffectBffEdgeDispatcher(options);

  return {
    handler: dispatcher.dispatch,
    dispose: dispatcher.dispose,
  };
}
