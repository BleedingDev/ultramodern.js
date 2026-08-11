import type React from 'react';
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import {
  InternalRuntimeContext,
  setGlobalContext,
} from '../../src/core/context';
import { Link as PrefetchLink } from '../../src/router/runtime/PrefetchLink';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('router runtime root', () => {
  afterEach(() => {
    setGlobalContext({ enableRsc: false });
    window.history.replaceState(null, '', '/');
    window._ROUTER_DATA = undefined;
  });

  it('provides the Modern prefetch Link to runtime consumers', async () => {
    const { routerPlugin } = await import('../../src/router/runtime/plugin');
    let beforeRender:
      | ((context: { router?: { Link?: React.ComponentType<any> } }) => void)
      | undefined;

    routerPlugin().setup?.({
      getRuntimeConfig: () => ({}),
      onBeforeRender: callback => {
        beforeRender = callback;
      },
      wrapRoot: () => undefined,
    } as any);

    if (!beforeRender) {
      throw new Error('Expected router plugin to register onBeforeRender');
    }

    const context: { router?: { Link?: React.ComponentType<any> } } = {};
    beforeRender(context);

    expect(context.router?.Link).toBe(PrefetchLink);
  });

  it('keeps the mounted RouterProvider tree across parent renders', async () => {
    (
      globalThis as typeof globalThis & {
        __webpack_require__?: { u: (chunkId: unknown) => string };
      }
    ).__webpack_require__ = {
      u: chunkId => String(chunkId),
    };

    const { routerPlugin } = await import('../../src/router/runtime/plugin');
    let mounts = 0;
    let unmounts = 0;
    const RouteProbe = () => {
      useEffect(() => {
        mounts += 1;
        return () => {
          unmounts += 1;
        };
      }, []);
      return <main>route content</main>;
    };
    const Shell = ({ children }: React.PropsWithChildren) => <>{children}</>;
    let RouterRoot: React.ComponentType<any> | undefined;
    const passThrough = { call: <T,>(value: T) => value };
    const notify = { call: () => undefined };

    routerPlugin({
      createRoutes: () => [
        {
          path: '/',
          element: <RouteProbe />,
        },
      ],
    }).setup?.({
      getHooks: () => ({
        modifyRoutes: passThrough,
        onAfterCreateRouter: notify,
        onAfterHydrateRouter: notify,
        onBeforeCreateRouter: notify,
        onBeforeHydrateRouter: notify,
      }),
      getRuntimeConfig: () => ({}),
      onBeforeRender: () => undefined,
      wrapRoot: (
        wrap: (App: React.ComponentType<any>) => React.ComponentType<any>,
      ) => {
        RouterRoot = wrap(Shell);
      },
    } as any);

    if (!RouterRoot) {
      throw new Error('Expected router plugin to register a root wrapper');
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const runtimeContext = {
      isBrowser: true,
      requestContext: { request: {}, response: {} },
      context: { request: {}, response: {} },
    } as any;

    await act(async () => {
      root.render(
        <InternalRuntimeContext.Provider value={runtimeContext}>
          <RouterRoot renderVersion={0} />
        </InternalRuntimeContext.Provider>,
      );
    });
    expect(container.textContent).toBe('route content');
    expect({ mounts, unmounts }).toEqual({ mounts: 1, unmounts: 0 });

    await act(async () => {
      root.render(
        <InternalRuntimeContext.Provider value={runtimeContext}>
          <RouterRoot renderVersion={1} />
        </InternalRuntimeContext.Provider>,
      );
    });
    expect(container.textContent).toBe('route content');
    expect({ mounts, unmounts }).toEqual({ mounts: 1, unmounts: 0 });

    await act(async () => {
      root.unmount();
    });
    expect(unmounts).toBe(1);
    container.remove();
  });
});
