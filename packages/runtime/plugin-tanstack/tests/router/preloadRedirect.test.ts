import { createMemoryHistory } from '@tanstack/history';
import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from '@tanstack/react-router';

describe('tanstack router-core preload redirects', () => {
  afterEach(() => {
    rstest.restoreAllMocks();
  });

  test('resolves concurrent preload redirects without stale loader work', async () => {
    const consoleErrorSpy = rstest
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const rootRoute = createRootRoute();
    const indexRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: () => null,
    });
    let redirectLoaderCalls = 0;
    const redirectRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/redirect',
      loader: async () => {
        redirectLoaderCalls += 1;
        await Promise.resolve();
        throw redirect({ to: '/target' });
      },
      component: () => null,
    });
    const targetLoader = rstest.fn(async () => 'target');
    const targetRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/target',
      loader: targetLoader,
      component: () => null,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([
        indexRoute,
        redirectRoute,
        targetRoute,
      ]),
      history: createMemoryHistory({
        initialEntries: ['/'],
      }),
      defaultStructuralSharing: true,
    });

    await Promise.all([
      router.preloadRoute({ to: '/redirect' }),
      router.preloadRoute({ to: '/redirect' }),
    ]);

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(router.options.defaultStructuralSharing).toBe(true);
    expect(redirectLoaderCalls).toBe(1);
    expect(targetLoader).toHaveBeenCalledTimes(1);
  });
});
