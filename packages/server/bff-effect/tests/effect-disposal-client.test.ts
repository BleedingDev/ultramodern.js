import * as Effect from 'effect/Effect';
import * as Scope from 'effect/Scope';
import { RpcGroup } from 'effect/unstable/rpc';

const managedRuntimeState = rs.hoisted(() => ({
  make: rs.fn(),
}));

rs.mock('effect/ManagedRuntime', () => {
  return { make: managedRuntimeState.make };
});

import { makeEffectRpcClient } from '../src/effect-client';

describe('Effect RPC client disposal', () => {
  beforeEach(() => {
    managedRuntimeState.make.mockReset();
  });

  test('shares one concurrent and repeated disposal promise', async () => {
    const scope = await Effect.runPromise(Scope.make());
    let releaseScopeClose!: () => void;
    const scopeClose = new Promise<void>(resolve => {
      releaseScopeClose = resolve;
    });
    const runPromise = rs
      .fn()
      .mockResolvedValueOnce(scope)
      .mockResolvedValueOnce({})
      .mockImplementationOnce(() => scopeClose);
    const disposeRuntime = rs.fn().mockResolvedValue(undefined);
    managedRuntimeState.make.mockReturnValue({
      runPromise,
      dispose: disposeRuntime,
    });

    const client = await Effect.runPromise(
      makeEffectRpcClient(RpcGroup.make(), {
        url: 'https://example.com/rpc',
      }),
    );
    const firstDispose = client.dispose();
    const concurrentDispose = client.dispose();

    expect(concurrentDispose).toBe(firstDispose);
    expect(runPromise).toHaveBeenCalledTimes(3);
    expect(disposeRuntime).not.toHaveBeenCalled();

    releaseScopeClose();
    await firstDispose;

    const repeatedDispose = client.dispose();
    expect(repeatedDispose).toBe(firstDispose);
    await repeatedDispose;
    expect(runPromise).toHaveBeenCalledTimes(3);
    expect(disposeRuntime).toHaveBeenCalledTimes(1);
  });

  test('tears down the runtime once and shares a scope-close rejection', async () => {
    const scope = await Effect.runPromise(Scope.make());
    const scopeCloseError = new Error('scope close failed');
    const runPromise = rs
      .fn()
      .mockResolvedValueOnce(scope)
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(scopeCloseError);
    const disposeRuntime = rs.fn().mockResolvedValue(undefined);
    managedRuntimeState.make.mockReturnValue({
      runPromise,
      dispose: disposeRuntime,
    });

    const client = await Effect.runPromise(
      makeEffectRpcClient(RpcGroup.make(), {
        url: 'https://example.com/rpc',
      }),
    );
    const firstDispose = client.dispose();
    const concurrentDispose = client.dispose();

    expect(concurrentDispose).toBe(firstDispose);
    await Promise.all([
      expect(firstDispose).rejects.toBe(scopeCloseError),
      expect(concurrentDispose).rejects.toBe(scopeCloseError),
    ]);
    expect(disposeRuntime).toHaveBeenCalledTimes(1);
    expect(client.dispose()).toBe(firstDispose);
    expect(runPromise).toHaveBeenCalledTimes(3);
  });

  test('disposes the runtime when initial scope creation fails', async () => {
    const scopeError = new Error('scope creation failed');
    const runPromise = rs.fn().mockRejectedValueOnce(scopeError);
    const disposeRuntime = rs
      .fn()
      .mockRejectedValueOnce(new Error('runtime disposal failed'));
    managedRuntimeState.make.mockReturnValue({
      runPromise,
      dispose: disposeRuntime,
    });

    await expect(
      Effect.runPromise(
        makeEffectRpcClient(RpcGroup.make(), {
          url: 'https://example.com/rpc',
        }),
      ),
    ).rejects.toMatchObject({
      _tag: 'EffectRpcClientError',
      cause: scopeError,
    });

    expect(runPromise).toHaveBeenCalledTimes(1);
    expect(disposeRuntime).toHaveBeenCalledTimes(1);
  });
});
