import { createEffectBffEdgeDispatcher } from '../src/effect/edge-dispatcher';
import { registerValidatorAwareHandlerFactory } from '../src/effect/entry-shape';
import type { EffectBffHandlerFactory } from '../src/effect/module';

describe('Effect edge dispatcher disposal', () => {
  test('retires immediately and drains a blocked dispatch before teardown', async () => {
    let markStarted!: () => void;
    const started = new Promise<void>(resolve => {
      markStarted = resolve;
    });
    let releaseRequest!: () => void;
    const blockedRequest = new Promise<void>(resolve => {
      releaseRequest = resolve;
    });
    const events: string[] = [];
    const disposeRuntime = rs.fn(async () => {
      events.push('dispose');
    });
    const createHandler =
      registerValidatorAwareHandlerFactory<EffectBffHandlerFactory>(() => ({
        handler: async () => {
          events.push('dispatch:start');
          markStarted();
          await blockedRequest;
          events.push('dispatch:end');
          return Response.json({ ok: true });
        },
        dispose: disposeRuntime,
      }));
    const dispatcher = await createEffectBffEdgeDispatcher({
      module: { createHandler },
    });

    const responsePromise = dispatcher.dispatch(
      new Request('https://example.com/api/blocked'),
    );
    await started;

    const firstDispose = dispatcher.dispose();
    const concurrentDispose = dispatcher.dispose();
    expect(concurrentDispose).toBe(firstDispose);
    expect(disposeRuntime).not.toHaveBeenCalled();
    await expect(
      dispatcher.dispatch(new Request('https://example.com/api/retired')),
    ).rejects.toThrow('Edge dispatcher is disposing or has been disposed');

    releaseRequest();
    await expect(responsePromise).resolves.toBeInstanceOf(Response);
    await firstDispose;

    expect(events).toEqual(['dispatch:start', 'dispatch:end', 'dispose']);
    expect(disposeRuntime).toHaveBeenCalledTimes(1);
    expect(dispatcher.dispose()).toBe(firstDispose);
  });

  test('shares cleanup rejection and remains retired', async () => {
    const cleanupError = new Error('scope close failed');
    const disposeRuntime = rs.fn().mockRejectedValue(cleanupError);
    const createHandler =
      registerValidatorAwareHandlerFactory<EffectBffHandlerFactory>(() => ({
        handler: () => Response.json({ ok: true }),
        dispose: disposeRuntime,
      }));
    const dispatcher = await createEffectBffEdgeDispatcher({
      module: { createHandler },
    });

    const firstDispose = dispatcher.dispose();
    const concurrentDispose = dispatcher.dispose();

    expect(concurrentDispose).toBe(firstDispose);
    await Promise.all([
      expect(firstDispose).rejects.toBe(cleanupError),
      expect(concurrentDispose).rejects.toBe(cleanupError),
    ]);
    expect(disposeRuntime).toHaveBeenCalledTimes(1);
    expect(dispatcher.dispose()).toBe(firstDispose);
    await expect(
      dispatcher.dispatch(new Request('https://example.com/api/retired')),
    ).rejects.toThrow('Edge dispatcher is disposing or has been disposed');
  });
});
