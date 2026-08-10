import { getInitialContext } from '../../src/core/context';
import {
  modifyRoutes,
  onAfterCreateRouter,
  onAfterHydrateRouter,
  onBeforeCreateRouter,
  onBeforeCreateRoutes,
  onBeforeHydrateRouter,
} from '../../src/router/runtime/hooks';
import {
  applyRouterRuntimeState,
  applyRouterServerPrepareResult,
  createRouterServerSnapshot,
  getRouterHydrationScripts,
  getRouterMatchedRouteIds,
  getRouterRuntimeState,
  getRouterServerSnapshot,
} from '../../src/router/runtime/lifecycle';

describe('router lifecycle seams', () => {
  it('should expose generic router runtime state helpers', () => {
    const context = getInitialContext(true) as any;
    applyRouterRuntimeState(context, {
      framework: 'custom-router',
      basename: '/shell',
      instance: { kind: 'router' },
      matches: [{ routeId: 'route-a', assetRouteId: 'mf/page' }],
      hydrationScripts: ['<script>one()</script>', '<script>two()</script>'],
      serverSnapshot: {
        matches: [{ routeId: 'route-a', assetRouteId: 'mf/page' }],
      },
    });

    expect(getRouterRuntimeState(context)?.framework).toBe('custom-router');
    expect(getRouterRuntimeState(context)).toMatchObject({
      framework: 'custom-router',
      basename: '/shell',
      matchedRouteIds: ['mf/page'],
      hydrationScript: '<script>one()</script>',
      hydrationScripts: ['<script>one()</script>', '<script>two()</script>'],
    });
    expect(getRouterServerSnapshot(context)).toMatchObject({
      framework: 'custom-router',
      basename: '/shell',
      matchedRouteIds: ['mf/page'],
      hydrationScript: '<script>one()</script>',
      hydrationScripts: ['<script>one()</script>', '<script>two()</script>'],
    });
    expect(getRouterHydrationScripts(context)).toEqual([
      '<script>one()</script>',
      '<script>two()</script>',
    ]);
    expect(getRouterMatchedRouteIds(context)).toEqual(['mf/page']);
  });

  it('should normalize and apply generic server prepare results', () => {
    const context = getInitialContext(false) as any;
    let cleaned = false;
    const snapshot = createRouterServerSnapshot({
      framework: 'plugin-router',
      basename: '/app',
      statusCode: 299,
      errors: { root: new Error('plugin error') },
      routerData: {
        loaderData: { root: { ok: true } },
        errors: {},
      },
      hydrationScripts: ['<script>hydrateA()</script>'],
      matches: [{ routeId: 'root', assetRouteId: 'asset-root' }],
    });

    applyRouterServerPrepareResult(context, {
      snapshot,
      cleanup: () => {
        cleaned = true;
      },
      state: {
        framework: 'plugin-router',
        basename: '/app',
        instance: { opaque: true },
      },
    });

    expect(getRouterRuntimeState(context)?.instance).toEqual({ opaque: true });
    expect(getRouterServerSnapshot(context)).toMatchObject({
      framework: 'plugin-router',
      basename: '/app',
      statusCode: 299,
      matchedRouteIds: ['asset-root'],
      hydrationScript: '<script>hydrateA()</script>',
    });
    getRouterRuntimeState(context)?.cleanup?.();
    expect(cleaned).toBe(true);
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

  it('should expose only the router-agnostic runtime state contract', () => {
    type RuntimeContext = ReturnType<typeof getInitialContext>;
    type DeprecatedRuntimeField = Extract<
      'tanstackRouter' | 'tanstackSsrScript' | 'tanstackMatchedModernRouteIds',
      keyof RuntimeContext
    >;

    const deprecatedRuntimeFields: DeprecatedRuntimeField[] = [];
    expect(deprecatedRuntimeFields).toEqual([]);

    const context = getInitialContext(false);
    applyRouterRuntimeState(context, {
      framework: 'router-without-framework-types',
      instance: { publicApi: true },
      matches: [{ routeId: 'route', assetRouteId: 'asset' }],
    });
    expect(getRouterRuntimeState(context)).toMatchObject({
      framework: 'router-without-framework-types',
      instance: { publicApi: true },
      matchedRouteIds: ['asset'],
    });
  });
});
