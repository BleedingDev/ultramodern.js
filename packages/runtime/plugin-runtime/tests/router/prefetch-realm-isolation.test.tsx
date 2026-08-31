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
});
