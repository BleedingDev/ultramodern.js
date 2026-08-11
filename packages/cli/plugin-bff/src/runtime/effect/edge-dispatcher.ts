// @effect-diagnostics anyUnknownInErrorContext:off asyncFunction:off strictBooleanExpressions:off
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

export {
  runWithEffectContext,
  useEffectContext,
  useOperationContext,
} from './edge-context';
export * from './handler';
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
  onError?: (
    error: unknown,
    context: EffectContext,
  ) => Promise<Response> | Response;
  onWarning?: (message: string) => void;
};

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
  const loaded = await resolveEffectBffModuleHandler(options.module, {
    openapi: options.openapi,
    dataPlatform: options.dataPlatform,
    onWarning: options.onWarning,
  });
  if (!loaded) {
    throw new Error(
      '[BFF][Effect] Invalid Effect edge module. Export defineEffectBff(...) or a { api, layer } HttpApi module.',
    );
  }

  return {
    dispatch: (
      request: Request,
      dispatchOptions: Omit<
        EffectBffEdgeDispatchOptions,
        'prefix' | 'onError'
      > = {},
    ) =>
      dispatchEffectBffRequest(loaded.handler, request, {
        ...dispatchOptions,
        prefix: options.prefix,
        onError: options.onError,
      }),
    dispose: async () => {
      await loaded.dispose?.();
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
