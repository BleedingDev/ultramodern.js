import React from 'react';

const loadableReady = rstest.fn(
  (callback: () => void, _options: { chunkLoadingGlobal: string }) => {
    callback();
  },
);

rstest.mock('@loadable/component', () => ({
  loadableReady,
}));

describe('hydrateRoot loadable chunk loading global', () => {
  const originalIsReact18 = process.env.IS_REACT18;
  const originalChunkLoadingGlobal = process.env.MODERN_CHUNK_LOADING_GLOBAL;

  beforeEach(() => {
    rstest.resetModules();
    loadableReady.mockClear();
    (globalThis as any).window = {
      _SSR_DATA: {
        mode: 'string',
        renderLevel: 2,
      },
    };
  });

  afterAll(() => {
    if (originalIsReact18 === undefined) {
      delete process.env.IS_REACT18;
    } else {
      process.env.IS_REACT18 = originalIsReact18;
    }
    if (originalChunkLoadingGlobal === undefined) {
      delete process.env.MODERN_CHUNK_LOADING_GLOBAL;
    } else {
      process.env.MODERN_CHUNK_LOADING_GLOBAL = originalChunkLoadingGlobal;
    }
    delete (globalThis as any).window;
  });

  test.each([
    {
      name: 'uses the compiled per-app global for React 18 hydration',
      isReact18: 'true',
      configured: '__REMOTE_INVENTORY_CHUNKS__',
      expected: '__REMOTE_INVENTORY_CHUNKS__',
    },
    {
      name: 'uses the legacy fallback for React 17 hydration',
      isReact18: 'false',
      configured: undefined,
      expected: '__LOADABLE_LOADED_CHUNKS__',
    },
  ])('$name', async ({ isReact18, configured, expected }) => {
    process.env.IS_REACT18 = isReact18;
    if (configured) {
      process.env.MODERN_CHUNK_LOADING_GLOBAL = configured;
    } else {
      delete process.env.MODERN_CHUNK_LOADING_GLOBAL;
    }
    const { hydrateRoot } = await import('../../../src/core/browser/hydrate');
    const hydratedRoot = { kind: 'hydrated-root' };
    const ModernHydrate = rstest.fn().mockResolvedValue(hydratedRoot);

    await expect(
      hydrateRoot(
        React.createElement('main'),
        { routes: [] } as never,
        rstest.fn() as never,
        ModernHydrate,
      ),
    ).resolves.toBe(hydratedRoot);

    expect(loadableReady).toHaveBeenCalledTimes(1);
    expect(loadableReady).toHaveBeenCalledWith(expect.any(Function), {
      chunkLoadingGlobal: expected,
    });
  });

  test('loads in a browser runtime without a process global', async () => {
    const nodeProcess = globalThis.process;
    rstest.stubGlobal('process', undefined);

    await expect(
      import('../../../src/core/browser/hydrate'),
    ).resolves.toBeDefined();

    rstest.stubGlobal('process', nodeProcess);
  });
});
