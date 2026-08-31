// @effect-diagnostics anyUnknownInErrorContext:off asyncFunction:off globalDate:off globalTimers:off newPromise:off strictBooleanExpressions:off
import type { HttpApi } from 'effect/unstable/httpapi';
import type { Rpc } from 'effect/unstable/rpc';

import { registerValidatorAwareHandlerFactory } from '../entry-shape';
import { mergeDataPlatformOptions } from './envelope';
import { createHttpApiHandler } from './http';
import { createRpcApiHandler } from './rpc';
import type {
  EffectApiPromiseClientFromApi,
  EffectBffDefinition,
  EffectBffHandlerFactory,
  EffectBffRuntime,
  EffectDataPlatformValidationOptions,
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
  const client = createLoaderMaterializedClientPlaceholder<TApi>();
  return {
    ...definition,
    createHandler,
    client,
  };
}

const LOADER_CLIENT_IGNORED_KEYS = new Set<PropertyKey>([
  'then',
  'catch',
  'finally',
  'toJSON',
  '$$typeof',
]);

/**
 * `defineEffectBff(...).client` is only materialized when the entry module
 * is imported through the `@api/index` transform (the webpack/rspack
 * loader swaps the module for generated client code). Importing the entry
 * directly (server code, scripts, tests) used to return a `client` typed as
 * fully functional but `undefined` at runtime — a bare TypeError with zero
 * explanation. This placeholder keeps the type contract while failing with
 * an actionable error on first property access.
 */
function createLoaderMaterializedClientPlaceholder<
  TApi extends HttpApi.Constraint,
>(): EffectApiPromiseClientFromApi<TApi> {
  const explain = (property: PropertyKey): never => {
    throw new Error(
      `[BFF][Effect] client.${String(property)} is not available here: the typed client only exists when the API entry is imported through the "@api/index" transformed path (the BFF loader replaces it with generated client code). On the server, use HttpApiClient or call the Effect layer directly.`,
    );
  };

  return new Proxy(Object.create(null), {
    get(_target, property) {
      // Keep async/inspection protocols (await, console.log, React internals)
      // from throwing so the placeholder stays inert until really used.
      if (
        typeof property === 'symbol' ||
        LOADER_CLIENT_IGNORED_KEYS.has(property)
      ) {
        return undefined;
      }
      return explain(property);
    },
  }) as EffectApiPromiseClientFromApi<TApi>;
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
