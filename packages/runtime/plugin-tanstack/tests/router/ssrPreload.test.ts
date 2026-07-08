import { preloadMatchedRouteComponents } from '../../src/runtime/ssrPreload';

describe('preloadMatchedRouteComponents', () => {
  test('preloads each component identity once per SSR pass', async () => {
    const sharedComponent = Object.assign(() => null, {
      preload: rstest.fn(),
    });

    await preloadMatchedRouteComponents({
      routesById: {
        child: {
          options: {
            component: sharedComponent,
          },
        },
        root: {
          options: {
            component: sharedComponent,
            pendingComponent: sharedComponent,
          },
        },
      },
      state: {
        matches: [{ routeId: 'root' }, { routeId: 'child' }],
      },
    } as never);

    expect(sharedComponent.preload).toHaveBeenCalledTimes(1);
  });
});
