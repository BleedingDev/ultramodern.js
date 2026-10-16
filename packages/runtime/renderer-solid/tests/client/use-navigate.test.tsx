import type { UseNavigateResult } from '@tanstack/router-core';
import { flush } from 'solid-js';
import { mountApplication } from '../../src/client';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useNavigate,
} from '../../src/router';

async function mountNavigation() {
  const navigation =
    Promise.withResolvers<UseNavigateResult<'/products/$slug'>>();
  const rootRoute = createRootRoute({
    component: () => {
      navigation.resolve(useNavigate({ from: '/products/$slug' }));
      return null;
    },
  });
  const productsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/products',
  });
  const routeTree = rootRoute.addChildren([
    productsRoute.addChildren([
      createRoute({ getParentRoute: () => productsRoute, path: '$slug' }),
    ]),
  ]);
  const history = createMemoryHistory({
    initialEntries: ['/products/red?revision=1#details'],
  });
  history.replace(history.location.href, { cart: 2 });
  const router = createRouter({ routeTree, history, isServer: false });
  await router.load();
  const root = document.createElement('div');
  document.body.append(root);
  const unmount = mountApplication(
    () => <RouterProvider router={router} />,
    root,
  );
  flush();
  return {
    navigate: await navigation.promise,
    router,
    history,
    dispose() {
      unmount();
      root.remove();
      history.destroy();
      flush();
    },
  };
}

describe('native Solid useNavigate', () => {
  test('uses the hook default route for relative navigation', async () => {
    const app = await mountNavigation();
    const options = { to: '..' };
    try {
      await app.navigate(options);
      expect(app.router.state.location.pathname).toBe('/products');
      expect(app.history.length).toBe(2);
      expect(options).toEqual({ to: '..' });
    } finally {
      app.dispose();
    }
  });

  test('an explicit route overrides the hook default route', async () => {
    const app = await mountNavigation();
    try {
      await app.navigate({ from: '/products', to: '..' });
      expect(app.router.state.location.pathname).toBe('/');
    } finally {
      app.dispose();
    }
  });

  test('forwards dynamic params, search, hash, state and replace to native navigation', async () => {
    const app = await mountNavigation();
    try {
      await app.navigate({
        to: '/products/$slug',
        params: previous => ({ ...previous, slug: 'blue' }),
        search: previous => ({ ...previous, sort: 'price' }),
        hash: previous => `${previous}-next`,
        state: previous => ({ ...previous, cart: Number(previous.cart) + 1 }),
        replace: true,
      });
      expect(app.router.state.location).toMatchObject({
        pathname: '/products/blue',
        search: { revision: 1, sort: 'price' },
        hash: 'details-next',
        state: { cart: 3 },
      });
      expect(app.history.location.href).toBe(
        '/products/blue?revision=1&sort=price#details-next',
      );
      expect(app.history.length).toBe(1);
    } finally {
      app.dispose();
    }
  });
});
