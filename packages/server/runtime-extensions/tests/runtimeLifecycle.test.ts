import {
  createDisposableServerRuntimeHandle,
  disposeServerRuntime,
  initializeDisposableServerRuntime,
  registerServerRuntimeDisposer,
} from '../src/runtimeLifecycle';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(next => {
    resolve = next;
  });
  return { promise, resolve };
};

describe('server runtime lifecycle', () => {
  test('shares one disposal across concurrent and repeated callers', async () => {
    const owner = {};
    const release = deferred();
    const dispose = rstest.fn(async () => release.promise);
    registerServerRuntimeDisposer(owner, dispose);

    const first = disposeServerRuntime(owner);
    const second = disposeServerRuntime(owner);
    expect(first).toBe(second);
    await Promise.resolve();
    expect(dispose).toHaveBeenCalledTimes(1);

    release.resolve();
    await Promise.all([first, second, disposeServerRuntime(owner)]);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  test('attempts every owned disposer when one fails synchronously', async () => {
    const owner = {};
    const completed = rstest.fn();
    registerServerRuntimeDisposer(owner, completed);
    registerServerRuntimeDisposer(owner, () => {
      throw new Error('close failed');
    });

    await expect(disposeServerRuntime(owner)).rejects.toMatchObject({
      errors: [expect.objectContaining({ message: 'close failed' })],
    });
    expect(completed).toHaveBeenCalledTimes(1);
  });

  test('retires ownership before a disposer can register re-entrantly', async () => {
    const owner = {};
    registerServerRuntimeDisposer(owner, () => {
      expect(() => registerServerRuntimeDisposer(owner, () => {})).toThrow(
        'retired server runtime',
      );
    });

    await disposeServerRuntime(owner);
    await disposeServerRuntime(owner);
  });

  test('drains in-flight requests before releasing their runtime', async () => {
    const owner = {};
    const releaseRequest = deferred();
    const dispose = rstest.fn(async () => {});
    registerServerRuntimeDisposer(owner, dispose);
    const handle = createDisposableServerRuntimeHandle(owner, async () => {
      await releaseRequest.promise;
      return new Response('done');
    });

    const response = handle(new Request('https://example.com/slow'));
    const retiring = handle.dispose();
    await Promise.resolve();
    expect(dispose).not.toHaveBeenCalled();

    releaseRequest.resolve();
    await expect(response).resolves.toBeInstanceOf(Response);
    await retiring;
    expect(dispose).toHaveBeenCalledTimes(1);
    await expect(
      handle(new Request('https://example.com/late')),
    ).rejects.toThrow('retired server runtime');
  });

  test('releases a failed candidate without touching the active runtime', async () => {
    const activeOwner = {};
    const candidateOwner = {};
    const activeDispose = rstest.fn(async () => {});
    const candidateDispose = rstest.fn(async () => {});
    registerServerRuntimeDisposer(activeOwner, activeDispose);
    registerServerRuntimeDisposer(candidateOwner, candidateDispose);
    const setupError = new Error('candidate setup failed');

    await expect(
      initializeDisposableServerRuntime(
        candidateOwner,
        () => new Response('candidate'),
        async () => {
          throw setupError;
        },
      ),
    ).rejects.toBe(setupError);

    expect(candidateDispose).toHaveBeenCalledTimes(1);
    expect(activeDispose).not.toHaveBeenCalled();
    await disposeServerRuntime(activeOwner);
  });
});
