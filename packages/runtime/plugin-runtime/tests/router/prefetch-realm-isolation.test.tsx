import {
  createMemoryRouter,
  type RouteObject,
  RouterProvider,
} from '@modern-js/runtime-utils/router';
import { render, waitFor } from '@testing-library/react';
import React, { act } from 'react';
import {
  InternalRuntimeContext,
  type TInternalRuntimeContext,
} from '../../src/core/context';
import { Link } from '../../src/router';

declare global {
  var __webpack_chunk_load_test__:
    | ((chunkId: string) => Promise<void>)
    | undefined;
  var __webpack_public_path_test__: string | undefined;
}

let runtimeContext = {} as TInternalRuntimeContext;

rstest.mock('react', () => {
  const originalModule = rstest.requireActual('react');
  const originContext = originalModule.useContext;
  const mockedUseContext = (context: unknown) =>
    context === InternalRuntimeContext
      ? runtimeContext
      : originContext(context);

  return {
    ...originalModule,
    useContext: mockedUseContext,
    default: { ...originalModule, useContext: mockedUseContext },
  };
});

const createRoutes = (id: string, duplicateLink = false): RouteObject[] => [
  {
    id: `root-${id}`,
    path: '/',
    element: (
      <>
        <Link to={id}>Warm route</Link>
        {duplicateLink ? <Link to={id}>Warm route again</Link> : null}
      </>
    ),
  },
  { id, path: id, element: <h1>{id}</h1> },
];

const renderRealm = (
  routes: RouteObject[],
  realm: TInternalRuntimeContext,
  chunkLoader: (chunkId: string) => Promise<void>,
  publicPath: string,
) => {
  runtimeContext = realm;
  global.__webpack_chunk_load_test__ = chunkLoader;
  global.__webpack_public_path_test__ = publicPath;

  let router;
  act(() => {
    router = createMemoryRouter(routes);
  });
  return render(<RouterProvider router={router as any} />);
};

const createRealm = (
  routes: RouteObject[],
  chunkId: string,
): TInternalRuntimeContext => ({
  isBrowser: true,
  routes,
  routeManifest: {
    routeAssets: {
      [routes[1].id!]: { assets: [], chunkIds: [chunkId] },
    },
  },
  requestContext: { request: {}, response: {} },
  context: { request: {}, response: {} },
});

describe('route prefetch cache realms', () => {
  afterEach(() => {
    delete global.__webpack_chunk_load_test__;
    delete global.__webpack_public_path_test__;
  });

  test('does not share identical route chunks across app runtime realms', async () => {
    const routes = createRoutes('realm-route');
    const loader = rstest.fn(() => Promise.resolve());
    const first = renderRealm(
      routes,
      createRealm(routes, 'shared'),
      loader,
      '/',
    );
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    first.unmount();

    const second = renderRealm(
      routes,
      createRealm(routes, 'shared'),
      loader,
      '/',
    );
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
    second.unmount();
  });

  test('does not share identical route chunks across webpack public paths', async () => {
    const routes = createRoutes('public-path-route');
    const realm = createRealm(routes, 'shared');
    const loader = rstest.fn(() => Promise.resolve());
    const first = renderRealm(routes, realm, loader, '/shell-a/');
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    first.unmount();

    const second = renderRealm(routes, realm, loader, '/shell-b/');
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
    second.unmount();
  });

  test('does not share identical route chunks across federation containers', async () => {
    const routes = createRoutes('container-route');
    const realm = createRealm(routes, 'shared');
    const hostLoader = rstest.fn(() => Promise.resolve());
    const remoteLoader = rstest.fn(() => Promise.resolve());
    const host = renderRealm(routes, realm, hostLoader, '/shared/');
    await waitFor(() => expect(hostLoader).toHaveBeenCalledTimes(1));
    host.unmount();

    const remote = renderRealm(routes, realm, remoteLoader, '/shared/');
    await waitFor(() => expect(remoteLoader).toHaveBeenCalledTimes(1));
    remote.unmount();
  });

  test('deduplicates identical route chunks inside one runtime realm', async () => {
    const routes = createRoutes('same-realm-route', true);
    const realm = createRealm(routes, 'shared');
    const loader = rstest.fn(() => Promise.resolve());
    const rendered = renderRealm(routes, realm, loader, '/same/');

    await waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    rendered.unmount();
  });

  test('warms changed route module inputs in the same runtime realm', async () => {
    const routeId = 'mutated-assets-route';
    let rerenderLink = () => {};
    const WarmupLink = () => {
      const [, setGeneration] = React.useState(0);
      rerenderLink = () => setGeneration(generation => generation + 1);
      return <Link to={routeId}>Warm route</Link>;
    };
    const routes = createRoutes(routeId);
    routes[0].element = <WarmupLink />;
    const realm = createRealm(routes, 'chunk-v1');
    const loader = rstest.fn(() => Promise.resolve());
    const rendered = renderRealm(routes, realm, loader, '/same/');

    await waitFor(() => {
      expect(loader).toHaveBeenCalledTimes(1);
      expect(loader).toHaveBeenNthCalledWith(1, 'chunk-v1');
    });

    realm.routeManifest!.routeAssets![routeId] = {
      assets: [],
      chunkIds: ['chunk-v2'],
    };
    act(() => rerenderLink());

    await waitFor(() => {
      expect(loader).toHaveBeenCalledTimes(2);
      expect(loader).toHaveBeenNthCalledWith(2, 'chunk-v2');
    });

    const nextLoader = rstest.fn(() => Promise.resolve());
    global.__webpack_chunk_load_test__ = nextLoader;
    act(() => rerenderLink());

    await waitFor(() => {
      expect(nextLoader).toHaveBeenCalledTimes(1);
      expect(nextLoader).toHaveBeenCalledWith('chunk-v2');
    });

    global.__webpack_public_path_test__ = '/next/';
    act(() => rerenderLink());

    await waitFor(() => {
      expect(nextLoader).toHaveBeenCalledTimes(2);
      expect(nextLoader).toHaveBeenNthCalledWith(2, 'chunk-v2');
    });
    rendered.unmount();
  });

  test('drops a queued stale asset generation before a slot opens', async () => {
    const blockerIds = Array.from(
      { length: 4 },
      (_, index) => `queued-blocker-${index}`,
    );
    const routeId = 'queued-target';
    let rerenderTarget = () => {};
    const TargetLink = () => {
      const [, setGeneration] = React.useState(0);
      rerenderTarget = () => setGeneration(generation => generation + 1);
      return <Link to={routeId}>Target</Link>;
    };
    const routes: RouteObject[] = [
      {
        id: 'queued-root',
        path: '/',
        element: (
          <>
            {blockerIds.map(id => (
              <Link key={id} to={id}>
                {id}
              </Link>
            ))}
            <TargetLink />
          </>
        ),
      },
      ...blockerIds.map(id => ({ id, path: id, element: <h1>{id}</h1> })),
      { id: routeId, path: routeId, element: <h1>{routeId}</h1> },
    ];
    const realm = createRealm(routes, 'unused');
    realm.routeManifest!.routeAssets = Object.fromEntries([
      ...blockerIds.map(id => [id, { assets: [], chunkIds: [`${id}-chunk`] }]),
      [routeId, { assets: [], chunkIds: ['stale-target-chunk'] }],
    ]);
    const resolvers: Array<() => void> = [];
    const loader = rstest.fn(
      () =>
        new Promise<void>(resolve => {
          resolvers.push(resolve);
        }),
    );
    const rendered = renderRealm(routes, realm, loader, '/queued/');

    await waitFor(() => expect(loader).toHaveBeenCalledTimes(4));
    expect(loader).not.toHaveBeenCalledWith('stale-target-chunk');

    realm.routeManifest!.routeAssets![routeId] = {
      assets: [],
      chunkIds: ['fresh-target-chunk'],
    };
    act(() => rerenderTarget());
    await act(async () => {
      resolvers.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(loader).toHaveBeenCalledTimes(5);
      expect(loader).toHaveBeenNthCalledWith(5, 'fresh-target-chunk');
      expect(loader).not.toHaveBeenCalledWith('stale-target-chunk');
    });

    await act(async () => {
      resolvers.splice(0).forEach(resolve => resolve());
      await Promise.resolve();
      await Promise.resolve();
    });
    rendered.unmount();
  });
});
