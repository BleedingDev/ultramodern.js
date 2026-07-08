// @effect-diagnostics anyUnknownInErrorContext:off asyncFunction:off globalDate:off globalTimers:off newPromise:off strictBooleanExpressions:off
import * as Layer from 'effect/Layer';
import { HttpRouter } from 'effect/unstable/http';
import { type Rpc, RpcServer } from 'effect/unstable/rpc';

import { getRpcSerializationLayer } from '../rpcSerialization';
import type { EffectRpcBffDefinition } from './types';

export function normalizeRpcPath(pathname: string | undefined) {
  if (!pathname || pathname === '/') {
    return '/rpc' as `/${string}`;
  }
  if (!pathname.startsWith('/')) {
    return `/${pathname}` as `/${string}`;
  }
  return pathname as `/${string}`;
}

export function createRpcApiHandler<TRpcs extends Rpc.Any = Rpc.Any>(
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
