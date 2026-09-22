import { runtime } from '@modern-js/plugin/runtime';
import { getRouterRuntimeState } from '@modern-js/runtime-extensions/router-state';
import { createRouterStatePlugin } from '@modern-js/runtime-extensions/router-state-plugin';
import { useLocation } from '@modern-js/runtime-utils/router';
import type React from 'react';
import { act, Fragment, StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import {
  InternalRuntimeContext,
  setGlobalContext,
} from '../../src/core/context';
import { routerProviderRegistryHooks } from '../../src/router/runtime/hooks';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('router runtime root', () => {
  afterEach(() => {
    setGlobalContext({ enableRsc: false });
    window.history.replaceState(null, '', '/');
    window._ROUTER_DATA = undefined;
  });

  it.each([
    false,
    true,
  ])('keeps router publication and the mounted tree stable (StrictMode: %s)', async strict => {
    const Wrapper = strict ? StrictMode : Fragment;
    const mountCounts = strict
      ? { mounts: 2, unmounts: 1 }
      : { mounts: 1, unmounts: 0 };
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
      const location = useLocation();
      useEffect(() => {
        mounts += 1;
        return () => {
          unmounts += 1;
        };
      }, []);
      return <main>route content{location.search}</main>;
    };
    const Shell = ({ children }: React.PropsWithChildren) => <>{children}</>;
    let RouterRoot: React.ComponentType<any> | undefined;
    const passThrough = { call: <T,>(value: T) => value };
    const notify = { call: () => undefined };
    const created = rstest.fn();

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
        onAfterCreateRouter: { call: created },
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
        <Wrapper>
          <InternalRuntimeContext.Provider value={runtimeContext}>
            <RouterRoot renderVersion={0} />
          </InternalRuntimeContext.Provider>
        </Wrapper>,
      );
    });
    expect(container.textContent).toBe('route content');
    expect({ mounts, unmounts }).toEqual(mountCounts);

    await act(async () => {
      root.render(
        <Wrapper>
          <InternalRuntimeContext.Provider value={runtimeContext}>
            <RouterRoot renderVersion={1} />
          </InternalRuntimeContext.Provider>
        </Wrapper>,
      );
    });
    expect(container.textContent).toBe('route content');
    expect({ mounts, unmounts }).toEqual(mountCounts);
    expect(created).toHaveBeenCalledTimes(1);
    await act(async () => {
      await created.mock.calls[0][0].router.navigate('/?next');
    });
    expect(container.textContent).toBe('route content?next');
    expect({ mounts, unmounts }).toEqual(mountCounts);

    await act(async () => {
      root.unmount();
    });
    expect(unmounts).toBe(mountCounts.unmounts + 1);
    container.remove();
  });
  it('delivers the native hash router and hydration events after fork state capture', async () => {
    (globalThis as any).__webpack_require__ = {
      u: (id: unknown) => String(id),
    };
    const { routerPlugin } = await import('../../src/router/runtime/plugin');
    window.history.replaceState(null, '', '/#/');
    window._ROUTER_DATA = { loaderData: {} } as any;
    const events: string[] = [];
    const { runtimeContext: manager } = runtime.run({
      config: {},
      plugins: [
        createRouterStatePlugin({ registryHooks: routerProviderRegistryHooks }),
        routerPlugin({
          supportHtml5History: false,
          createRoutes: () => [
            { id: 'hash', path: '/', element: <main>Hash route</main> },
          ],
        }),
        {
          name: 'observe-router-hydration',
          setup(api: any) {
            api.onBeforeCreateRouter(() => events.push('before-create'));
            api.onAfterCreateRouter((event: any) => {
              expect(
                getRouterRuntimeState(event.runtimeContext)?.instance,
              ).toBe(event.router);
              events.push('after-create');
            });
            api.onBeforeHydrateRouter(() => events.push('before-hydrate'));
            api.onAfterHydrateRouter(() => events.push('after-hydrate'));
          },
        },
      ] as any,
    });
    const runtimeContext = {
      isBrowser: true,
      requestContext: { request: {}, response: {} },
      context: { request: {}, response: {} },
    } as any;
    await manager.hooks.onBeforeRender.call(runtimeContext);
    const Shell = ({ children }: React.PropsWithChildren) => <>{children}</>;
    const RouterRoot = manager.hooks.wrapRoot.call(Shell);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          <InternalRuntimeContext.Provider value={runtimeContext}>
            <RouterRoot />
          </InternalRuntimeContext.Provider>,
        );
      });
      expect(container.textContent).toBe('Hash route');
      expect(events).toEqual([
        'before-create',
        'after-create',
        'before-hydrate',
        'after-hydrate',
      ]);
      expect(getRouterRuntimeState(runtimeContext)?.framework).toBe(
        'react-router',
      );
    } finally {
      await act(async () => root.unmount());
      (
        getRouterRuntimeState(runtimeContext)?.instance as {
          dispose?: () => void;
        }
      )?.dispose?.();
      container.remove();
    }
  });
});
