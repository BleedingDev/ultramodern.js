import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { Rpc, RpcGroup, RpcMiddleware } from 'effect/rpc';

import { makeEffectRpcClient } from '../src/effect-client';

const makeClientGroup = () => {
  const middleware = RpcMiddleware.Service()('DisposalProbe', {
    requiredForClient: true,
  });
  return {
    middleware,
    group: RpcGroup.make(Rpc.make('ping').middleware(middleware)),
  };
};

describe('Effect RPC client disposal', () => {
  test('runs acquired finalizers once across concurrent and repeated disposal', async () => {
    const { group, middleware } = makeClientGroup();
    const disposed = rs.fn();
    const middlewareLayer = Layer.mergeAll(
      RpcMiddleware.layerClient(middleware, ({ next, request }) =>
        next(request),
      ),
      Layer.effectDiscard(
        Effect.acquireRelease(Effect.void, () => Effect.sync(disposed)),
      ),
    );
    const client = await Effect.runPromise(
      makeEffectRpcClient(group, {
        url: 'https://example.com/rpc',
        middlewareLayer,
      }),
    );

    const firstDispose = client.dispose();
    const concurrentDispose = client.dispose();
    await Promise.all([firstDispose, concurrentDispose]);
    await client.dispose();

    expect(disposed).toHaveBeenCalledTimes(1);
  });

  test('preserves the construction error when client scope creation fails', async () => {
    const { group, middleware } = makeClientGroup();
    const scopeError = new Error('scope creation failed');
    const failingLayer = RpcMiddleware.layerClient(
      middleware,
      Effect.fail(scopeError),
    );

    await expect(
      Effect.runPromise(
        makeEffectRpcClient(group, {
          url: 'https://example.com/rpc',
          middlewareLayer: failingLayer,
        }),
      ),
    ).rejects.toMatchObject({
      _tag: 'EffectRpcClientError',
      cause: scopeError,
    });
  });
});
