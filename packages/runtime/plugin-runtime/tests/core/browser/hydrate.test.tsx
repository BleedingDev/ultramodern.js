import { SSR_HYDRATION_ID_PREFIX } from '@modern-js/utils/universal/constants';
import React from 'react';

const nativeHydrateRoot = rstest.fn(() => ({ kind: 'react-root' }));
const loadableReady = rstest.fn(
  (callback: () => void, _options: { chunkLoadingGlobal: string }) => {
    callback();
    return Promise.resolve();
  },
);

rstest.mock('@loadable/component', () => ({
  loadableReady,
}));
rstest.mock('react-dom/client', () => ({
  hydrateRoot: nativeHydrateRoot,
}));

describe('hydrateRoot loadable chunk loading global', () => {
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
    if (originalChunkLoadingGlobal === undefined) {
      delete process.env.MODERN_CHUNK_LOADING_GLOBAL;
    } else {
      process.env.MODERN_CHUNK_LOADING_GLOBAL = originalChunkLoadingGlobal;
    }
    delete (globalThis as any).window;
  });

  test.each([
    {
      name: 'uses the compiled per-app chunk loading global',
      configured: '__REMOTE_INVENTORY_CHUNKS__',
      expected: '__REMOTE_INVENTORY_CHUNKS__',
    },
    {
      name: 'uses the legacy fallback when the chunk loading global is unset',
      configured: undefined,
      expected: '__LOADABLE_LOADED_CHUNKS__',
    },
  ])('$name', async ({ configured, expected }) => {
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

  test('delegates hydration to the native React root and preserves the promise contract', async () => {
    const { hydrateWithReact } = await import(
      '../../../src/core/browser/hydrate'
    );
    const App = React.createElement('main');
    const rootElement = {} as HTMLElement;
    const nativeRoot = nativeHydrateRoot();
    nativeHydrateRoot.mockClear();
    nativeHydrateRoot.mockReturnValueOnce(nativeRoot);

    await expect(hydrateWithReact(App, rootElement)).resolves.toBe(nativeRoot);
    expect(nativeHydrateRoot).toHaveBeenCalledWith(rootElement, App, {
      identifierPrefix: SSR_HYDRATION_ID_PREFIX,
    });
  });

  test('loads in a browser runtime without a process global', async () => {
    const nodeProcess = globalThis.process;
    rstest.stubGlobal('process', undefined);

    const hydrate = await import('../../../src/core/browser/hydrate');
    expect(hydrate).toBeDefined();

    rstest.stubGlobal('process', nodeProcess);
  });
});
