// @effect-diagnostics anyUnknownInErrorContext:off asyncFunction:off globalDate:off globalTimers:off newPromise:off strictBooleanExpressions:off
import * as Layer from 'effect/Layer';
import { HttpRouter, HttpServer } from 'effect/unstable/http';
import type { HttpApi } from 'effect/unstable/httpapi';
import type { Rpc } from 'effect/unstable/rpc';

import { prepareJsonRequestBody } from './batch';
import { createDataPlatformBatchRequestHandler } from './batch-handler';
import { validateDataPlatformRequestEnvelope } from './envelope';
import { createOpenApiLayer } from './openapi';
import { getRequestPathname, isRpcRequest } from './routing';
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

  const withDataPlatformValidation = async (
    request: Request,
    context?: Parameters<typeof httpApiHandler.handler>[1],
  ) => {
    // Policy seam first: every HttpApi request, direct or batched item,
    // passes through here, so batch fan-out cannot bypass validator.
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

  const batchHandler = createDataPlatformBatchRequestHandler({
    dataPlatform: options.dataPlatform,
    handleItem: withDataPlatformValidation,
  });

  const handleHttpApiRequest = async (
    request: Request,
    context?: Parameters<typeof httpApiHandler.handler>[1],
  ) => {
    const pathname = getRequestPathname(request);
    if (batchHandler.enabled && pathname === batchHandler.path) {
      // Outer batch POST transport, not an API operation: each batched item is
      // dispatched through withDataPlatformValidation and hits policy handling.
      return batchHandler.handle(request, context);
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
      context?: Parameters<typeof httpApiHandler.handler>[1],
    ) => {
      if (isRpcRequest(request, rpcPath)) {
        const policyDenial = options.validateRequest?.(request);
        if (policyDenial) {
          return policyDenial;
        }
        return rpcHandler.handler(request, toEffectServiceContext(context));
      }
      return handleHttpApiRequest(request, context);
    },
    dispose: async () => {
      await Promise.all([httpApiHandler.dispose(), rpcHandler.dispose()]);
    },
  };
}
