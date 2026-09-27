// @effect-diagnostics anyUnknownInErrorContext:off asyncFunction:off globalDate:off globalTimers:off newPromise:off strictBooleanExpressions:off
import type { HttpApi } from 'effect/unstable/httpapi';
import type { Rpc } from 'effect/unstable/rpc';

import { registerValidatorAwareHandlerFactory } from '../entry-shape';
import { mergeDataPlatformOptions } from './envelope';
import { createHttpApiHandler } from './http';
import { createRpcApiHandler } from './rpc';
import type {
  EffectBffDefinition,
  EffectBffHandlerFactory,
  EffectBffRuntime,
  EffectRpcBffDefinition,
  EffectRpcBffHandlerFactory,
  EffectRpcRuntimeLayer,
  EffectRuntimeLayer,
} from './types';

export function defineEffectBff<
  TApi extends HttpApi.Constraint,
  TLayer extends EffectRuntimeLayer,
  TRpcs extends Rpc.Any = Rpc.Any,
>(
  definition: EffectBffDefinition<TApi, TLayer, TRpcs>,
): EffectBffDefinition<TApi, TLayer, TRpcs> & EffectBffRuntime<TApi, TLayer> {
  const createHandler = registerValidatorAwareHandlerFactory<
    EffectBffHandlerFactory<TApi, TLayer>
  >(options => {
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
      interceptRequest: definition.interceptRequest,
      validateRequest: options?.validateRequest,
    });
  });
  return {
    ...definition,
    createHandler,
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
