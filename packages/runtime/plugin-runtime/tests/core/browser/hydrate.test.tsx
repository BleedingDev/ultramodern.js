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
    delete (globalThis as any).window;
  });

  test('uses the loadable fallback when no build constant is present', async () => {
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
      chunkLoadingGlobal: '__LOADABLE_LOADED_CHUNKS__',
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
