import { getInitialContext } from '../../src/core/context';
import { applyRouterRuntimeState } from '../../src/router/runtime/lifecycle';
import {
  modifyRoutes,
  onAfterCreateRouter,
  onAfterHydrateRouter,
  onBeforeCreateRouter,
  onBeforeCreateRoutes,
  onBeforeHydrateRouter,
} from '../../src/router/runtime/hooks';

describe('router lifecycle seams', () => {
  it('should expose generic router runtime state helpers', () => {
    const context = getInitialContext(true) as any;
    applyRouterRuntimeState(context, {
      framework: 'tanstack',
      basename: '/shell',
      instance: { kind: 'router' },
      matchedRouteIds: ['mf/page'],
      hydrationScript: '<script />',
      serverSnapshot: {
        matchedRouteIds: ['mf/page'],
      },
    });

    expect(context.routerFramework).toBe('tanstack');
    expect(context.routerRuntime).toMatchObject({
      framework: 'tanstack',
      basename: '/shell',
      matchedRouteIds: ['mf/page'],
      hydrationScript: '<script />',
    });
    expect(context.routerServerSnapshot).toMatchObject({
      framework: 'tanstack',
      basename: '/shell',
      matchedRouteIds: ['mf/page'],
    });
  });

  it('should register create and hydrate hook surfaces alongside existing route hooks', () => {
    for (const hook of [
      modifyRoutes,
      onBeforeCreateRoutes,
      onBeforeCreateRouter,
      onAfterCreateRouter,
      onBeforeHydrateRouter,
      onAfterHydrateRouter,
    ]) {
      expect(hook).toBeDefined();
      expect(typeof (hook as any).call).toBe('function');
    }
  });
});
