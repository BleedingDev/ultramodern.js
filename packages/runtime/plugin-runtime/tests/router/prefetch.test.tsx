import {
  createMemoryRouter,
  type LoaderFunctionArgs,
  type RouteObject,
  RouterProvider,
} from '@modern-js/runtime-utils/router';
import { fireEvent, render, waitFor } from '@testing-library/react';
import React, { act } from 'react';
import { InternalRuntimeContext } from '../../src/core/context';
import { Link, NavLink } from '../../src/router';

declare global {
  var __webpack_chunk_load_test__:
    | ((chunkId: string) => Promise<void>)
    | undefined;
  var _SSR_DATA: unknown;
}

let mockRoutes: RouteObject[] = [];
let mockRouteManifest = {
  routeAssets: {} as Record<string, { chunkIds: string[]; assets: string[] }>,
};

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];

  private callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }

  observe = rstest.fn();
  disconnect = rstest.fn();
  unobserve = rstest.fn();
  takeRecords = () => [];

  trigger(isIntersecting = true) {
    this.callback(
      [
        {
          isIntersecting,
        } as IntersectionObserverEntry,
      ],
      this as unknown as IntersectionObserver,
    );
  }
}

rstest.mock('react', () => {
  const originalModule = rstest.requireActual('react');
  const originContext = originalModule.useContext;
  const mockedUseContext = (context: unknown) => {
    if (context === InternalRuntimeContext) {
      return {
        routes: mockRoutes,
        routeManifest: mockRouteManifest,
      };
    }

    return originContext(context);
  };
  return {
    ...originalModule,
    useContext: mockedUseContext,
    default: {
      ...originalModule,
      useContext: mockedUseContext,
    },
  };
});

const createRouteAssets = (routes: RouteObject[]) => {
  const routeAssets: Record<string, { chunkIds: string[]; assets: string[] }> =
    {};

  for (const route of routes) {
    if (route.id) {
      routeAssets[route.id] = {
        chunkIds: [route.id],
        assets: [route.id],
      };
    }
  }

  return {
    routeAssets,
  };
};

const setRoutes = (routes: RouteObject[]) => {
  mockRoutes = routes;
  mockRouteManifest = createRouteAssets(routes);
};

const renderRouter = (routes: RouteObject[]) => {
  setRoutes(routes);

  let router;
  act(() => {
    router = createMemoryRouter(routes);
  });

  return render(<RouterProvider router={router as any} />);
};

const createTargetRoute = (
  id: string,
  options: Partial<RouteObject> = {},
): RouteObject => ({
  id,
  path: id,
  loader: ({ request }: LoaderFunctionArgs) => null,
  element: <h1>{id}</h1>,
  ...options,
});

const removePrefetchLinks = () => {
  document
    .querySelectorAll('link[rel="prefetch"][as="fetch"]')
    .forEach(link => link.remove());
};

const setConnection = (connection: unknown) => {
  Object.defineProperty(global.navigator, 'connection', {
    configurable: true,
    value: connection,
  });
};

describe('prefetch', () => {
  const intentEvents = ['focus', 'mouseEnter', 'touchStart'] as const;
  beforeEach(() => {
    rstest.useFakeTimers();
    rstest.resetModules();
    rstest.clearAllMocks();
    removePrefetchLinks();
    MockIntersectionObserver.instances = [];
    Object.defineProperty(global, 'IntersectionObserver', {
      configurable: true,
      value: MockIntersectionObserver,
    });
    setConnection(undefined);
    global.__webpack_chunk_load_test__ = rstest.fn(() => Promise.resolve());
    global._SSR_DATA = {};
  });

  afterEach(() => {
    removePrefetchLinks();
    setConnection(undefined);
    delete (global as { IntersectionObserver?: unknown }).IntersectionObserver;
    rstest.useRealTimers();
  });

  intentEvents.forEach(event => {
    test(`support intent on ${event}`, async () => {
      const id = `intent-${event}`;
      const routes = [
        {
          id: `root-${id}`,
          path: '/',
          element: <Link {...{ to: id, prefetch: 'intent' }} />,
        },
        createTargetRoute(id, {
          handle: {
            navigationWarmup: {
              data: true,
            },
          },
        }),
      ];

      const { container, unmount } = renderRouter(routes);

      fireEvent[event](container.firstChild!);

      act(() => {
        rstest.runAllTimers();
      });

      expect(MockIntersectionObserver.instances).toHaveLength(0);
      expect(global.__webpack_chunk_load_test__).toBeCalledTimes(1);
      const dataHref = document.head
        .querySelector('link[rel="prefetch"][as="fetch"]')
        ?.getAttribute('href');
      expect(
        dataHref?.includes(`${id}?__loader=${id}&__ssrDirect=true`),
      ).toBeTruthy();
      unmount();
    });
  });

  test('supports render by default with loader data prefetch', async () => {
    const id = 'default-render';
    const routes = [
      {
        id: `root-${id}`,
        path: '/',
        element: <Link to={id}>Default render</Link>,
      },
      createTargetRoute(id),
    ];

    const { unmount } = renderRouter(routes);
    rstest.useRealTimers();

    await waitFor(() => {
      expect(global.__webpack_chunk_load_test__).toBeCalledTimes(1);
      const dataHref = document.head
        .querySelector('link[rel="prefetch"][as="fetch"]')
        ?.getAttribute('href');
      expect(
        dataHref?.includes(`${id}?__loader=${id}&__ssrDirect=true`),
      ).toBeTruthy();
    });

    unmount();
  });

  test('keeps data prefetch working without a webpack chunk loader', async () => {
    const id = 'missing-chunk-loader';
    delete (global as { __webpack_chunk_load_test__?: unknown })
      .__webpack_chunk_load_test__;
    const routes = [
      {
        id: `root-${id}`,
        path: '/',
        element: <Link to={id}>No chunk loader</Link>,
      },
      createTargetRoute(id),
    ];

    const { unmount } = renderRouter(routes);
    rstest.useRealTimers();

    await waitFor(() => {
      expect(
        document.head.querySelector('link[rel="prefetch"][as="fetch"]'),
      ).not.toBeNull();
    });
    unmount();
  });

  test('retries route module warmup after a rejected chunk load', async () => {
    const id = 'chunk-load-retry';
    const failure = new Error('transient chunk failure');
    const consoleError = rstest
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    global.__webpack_chunk_load_test__ = rstest
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(undefined);
    const routes = [
      {
        id: `root-${id}`,
        path: '/',
        element: <Link to={id}>Retry chunk</Link>,
      },
      createTargetRoute(id),
    ];

    const firstRender = renderRouter(routes);
    rstest.useRealTimers();
    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(failure);
    });
    firstRender.unmount();

    const secondRender = renderRouter(routes);
    await waitFor(() => {
      expect(global.__webpack_chunk_load_test__).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      await Promise.resolve();
    });
    secondRender.unmount();
    consoleError.mockRestore();
  });

  test('skips data prefetch when the route opts out', async () => {
    const id = 'default-render-data-opt-out';
    const routes = [
      {
        id: `root-${id}`,
        path: '/',
        element: <Link to={id}>Default render</Link>,
      },
      createTargetRoute(id, {
        handle: {
          navigationWarmup: {
            data: false,
          },
        },
      }),
    ];

    const { unmount } = renderRouter(routes);
    rstest.useRealTimers();

    await waitFor(() => {
      expect(global.__webpack_chunk_load_test__).toBeCalledTimes(1);
    });

    expect(
      document.head.querySelector('link[rel="prefetch"][as="fetch"]'),
    ).toBeNull();
    unmount();
  });

  test('supports render data prefetch when the route opts in', async () => {
    const id = 'render-data';
    const routes = [
      {
        id: `root-${id}`,
        path: '/',
        element: <Link {...{ to: id, prefetch: 'render' }} />,
      },
      createTargetRoute(id, {
        handle: {
          navigationWarmup: {
            data: true,
          },
        },
      }),
    ];

    const { unmount } = renderRouter(routes);

    act(() => {
      rstest.runAllTimers();
    });

    rstest.useRealTimers();

    await waitFor(() => {
      expect(global.__webpack_chunk_load_test__).toBeCalledTimes(1);
      const dataHref = document.head
        .querySelector('link[rel="prefetch"][as="fetch"]')
        ?.getAttribute('href');
      expect(
        dataHref?.includes(`${id}?__loader=${id}&__ssrDirect=true`),
      ).toBeTruthy();
    });
    unmount();
  });

  test('supports viewport preload without data prefetch', async () => {
    const id = 'viewport-preload';
    const routes = [
      {
        id: `root-${id}`,
        path: '/',
        element: (
          <Link to={id} prefetch="none" preload="viewport">
            Viewport
          </Link>
        ),
      },
      createTargetRoute(id, {
        handle: {
          navigationWarmup: {
            data: true,
          },
        },
      }),
    ];

    const { unmount } = renderRouter(routes);

    expect(global.__webpack_chunk_load_test__).toBeCalledTimes(0);
    expect(MockIntersectionObserver.instances).toHaveLength(1);

    act(() => {
      MockIntersectionObserver.instances[0].trigger();
    });
    rstest.useRealTimers();

    await waitFor(() => {
      expect(global.__webpack_chunk_load_test__).toBeCalledTimes(1);
    });
    expect(
      document.head.querySelector('link[rel="prefetch"][as="fetch"]'),
    ).toBeNull();
    unmount();
  });

  test('prefetch none disables default render and viewport warmup', () => {
    const id = 'no-prefetch';
    const routes = [
      {
        id: `root-${id}`,
        path: '/',
        element: (
          <Link to={id} prefetch="none">
            No prefetch
          </Link>
        ),
      },
      createTargetRoute(id),
    ];

    const { unmount } = renderRouter(routes);

    act(() => {
      rstest.runAllTimers();
    });

    expect(global.__webpack_chunk_load_test__).toBeCalledTimes(0);
    expect(MockIntersectionObserver.instances).toHaveLength(0);
    unmount();
  });

  test('skips warmup for external absolute URLs', async () => {
    const id = 'external-link';
    const routes = [
      {
        id: `root-${id}`,
        path: '/',
        element: (
          <Link to="https://example.com/settings">External settings</Link>
        ),
      },
      createTargetRoute(id),
    ];

    const { unmount } = renderRouter(routes);

    act(() => {
      rstest.runAllTimers();
    });

    expect(global.__webpack_chunk_load_test__).toBeCalledTimes(0);
    unmount();
  });

  test('skips warmup when Save-Data is enabled', async () => {
    const id = 'save-data';
    setConnection({
      saveData: true,
    });

    const routes = [
      {
        id: `root-${id}`,
        path: '/',
        element: <Link to={id}>Save data</Link>,
      },
      createTargetRoute(id),
    ];

    const { unmount } = renderRouter(routes);

    act(() => {
      rstest.runAllTimers();
    });

    expect(global.__webpack_chunk_load_test__).toBeCalledTimes(0);
    unmount();
  });

  test('skips warmup on slow effective connection types', async () => {
    const id = 'slow-network';
    setConnection({
      effectiveType: '2g',
    });

    const routes = [
      {
        id: `root-${id}`,
        path: '/',
        element: <Link to={id}>Slow network</Link>,
      },
      createTargetRoute(id),
    ];

    const { unmount } = renderRouter(routes);

    act(() => {
      rstest.runAllTimers();
    });

    expect(global.__webpack_chunk_load_test__).toBeCalledTimes(0);
    unmount();
  });

  test('caps concurrent warmups and retries cancelled queued work', async () => {
    const ids = Array.from({ length: 6 }, (_, index) => `concurrent-${index}`);
    const resolvers: Array<() => void> = [];
    global.__webpack_chunk_load_test__ = rstest.fn(
      () =>
        new Promise<void>(resolve => {
          resolvers.push(resolve);
        }),
    );

    const routes = [
      {
        id: 'root-concurrent',
        path: '/',
        element: (
          <>
            {ids.map(id => (
              <Link key={id} to={id}>
                {id}
              </Link>
            ))}
          </>
        ),
      },
      ...ids.map(id => createTargetRoute(id)),
    ];

    const firstRender = renderRouter(routes);
    rstest.useRealTimers();

    await waitFor(() => {
      expect(global.__webpack_chunk_load_test__).toBeCalledTimes(4);
    });
    firstRender.unmount();
    const secondRender = renderRouter(routes);

    await act(async () => {
      resolvers.shift()?.();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(global.__webpack_chunk_load_test__).toBeCalledTimes(5);
      expect(global.__webpack_chunk_load_test__).toHaveBeenNthCalledWith(
        5,
        ids[4],
      );
    });

    await act(async () => {
      resolvers.splice(0).forEach(resolve => resolve());
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(global.__webpack_chunk_load_test__).toBeCalledTimes(6);
    });
    await act(async () => {
      resolvers.splice(0).forEach(resolve => resolve());
      await Promise.resolve();
      await Promise.resolve();
    });

    secondRender.unmount();
  });

  test('NavLink uses the same default render warmup', async () => {
    const id = 'navlink-render';
    const routes = [
      {
        id: `root-${id}`,
        path: '/',
        element: <NavLink to={id}>Navigation</NavLink>,
      },
      createTargetRoute(id),
    ];

    const { unmount } = renderRouter(routes);
    rstest.useRealTimers();

    await waitFor(() => {
      expect(global.__webpack_chunk_load_test__).toBeCalledTimes(1);
    });
    unmount();
  });
});
