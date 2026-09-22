import { runtime } from '@modern-js/plugin/runtime';
import {
  applyRouterRuntimeState,
  applyRouterServerPrepareResult,
  cleanupRouterRuntimeState,
  createRouterServerSnapshot,
  getRouterHydrationScripts,
  getRouterMatchedRouteIds,
  getRouterRuntimeState,
  getRouterServerSnapshot,
} from '@modern-js/runtime-extensions/router-state';
import { createRouterStatePlugin } from '@modern-js/runtime-extensions/router-state-plugin';
import * as contextAPI from '../../src/core/context';
import { getInitialContext, setGlobalContext } from '../../src/core/context';
import { routerProviderRegistryHooks } from '../../src/router/runtime/hooks';

describe('router lifecycle seams', () => {
  it('keeps native hooks public and fork state helpers at their owning package', () => {
    expect(contextAPI.routerProviderRegistryHooks).toBe(
      routerProviderRegistryHooks,
    );
    for (const name of [
      'applyRouterRuntimeState',
      'createRouterRuntimeState',
      'getRouterRuntimeState',
      'createRouterServerSnapshot',
      'getRouterServerSnapshot',
    ]) {
      expect(name in contextAPI).toBe(false);
    }
  });

  it('projects real native SSR events before later taps and excludes redirected or failed requests', async () => {
    setGlobalContext({ enableRsc: false });
    (globalThis as any).__webpack_require__ = {
      u: (id: unknown) => String(id),
    };
    const { routerPlugin } = await import(
      '../../src/router/runtime/plugin.node'
    );
    let outcome: 'success' | 'redirect' | 'failure' = 'success';
    const observed: unknown[] = [];
    const { runtimeContext: manager } = runtime.run({
      config: {},
      plugins: [
        createRouterStatePlugin({ registryHooks: routerProviderRegistryHooks }),
        routerPlugin({
          createRoutes: () => [
            {
              id: 'root',
              path: '/',
              loader: () => {
                if (outcome === 'redirect')
                  return new Response(null, {
                    status: 302,
                    headers: { Location: '/next' },
                  });
                if (outcome === 'failure') throw new Error('loader failed');
                return { result: 'native loader' };
              },
            },
          ],
        }),
        {
          name: 'observe-native-router',
          setup(api: any) {
            api.onAfterCreateRouter((event: any) =>
              observed.push(getRouterRuntimeState(event.runtimeContext)),
            );
          },
        },
      ] as any,
    });
    const createContext = () =>
      Object.assign(getInitialContext(false), {
        ssrContext: {
          request: { raw: new Request('http://localhost/'), pathname: '/' },
          response: { setHeader() {}, status() {}, locals: {} },
          baseUrl: '/',
          mode: 'string',
          loaderFailureMode: 'clientRender',
        },
      });
    const context = createContext();
    await manager.hooks.onBeforeRender.call(context);
    expect(observed).toHaveLength(1);
    expect(observed[0]).toBe(getRouterRuntimeState(context));
    expect(getRouterServerSnapshot(context)).toMatchObject({
      framework: 'react-router',
      statusCode: 200,
      matchedRouteIds: ['root'],
      routerData: { loaderData: { root: { result: 'native loader' } } },
    });
    expect(context.linkPrefetchPolicy).toBeDefined();

    outcome = 'redirect';
    const redirected = createContext();
    const response = await manager.hooks.onBeforeRender.call(redirected);
    expect(response).toBeInstanceOf(Response);
    expect(getRouterRuntimeState(redirected)).toBeUndefined();

    outcome = 'failure';
    const failed = createContext();
    await expect(manager.hooks.onBeforeRender.call(failed)).rejects.toThrow(
      'loader failed',
    );
    expect(getRouterRuntimeState(failed)).toBeUndefined();
    expect(observed).toHaveLength(1);
  });

  it('should expose generic router runtime state helpers', () => {
    const context = getInitialContext(true) as any;
    applyRouterServerPrepareResult(context, {
      state: {
        framework: 'custom-router',
        basename: '/shell',
        instance: { kind: 'router' },
      },
      snapshot: {
        framework: 'custom-router',
        basename: '/shell',
        hydrationScripts: ['<script>one()</script>', '<script>two()</script>'],
        matches: [{ routeId: 'route-a', assetRouteId: 'mf/page' }],
      },
    });

    expect(getRouterRuntimeState(context)?.framework).toBe('custom-router');
    expect(getRouterRuntimeState(context)).toMatchObject({
      framework: 'custom-router',
      basename: '/shell',
    });
    expect(getRouterServerSnapshot(context)).toMatchObject({
      framework: 'custom-router',
      basename: '/shell',
      matchedRouteIds: ['mf/page'],
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
      hydrationScripts: ['<script>hydrateA()</script>'],
    });
    getRouterRuntimeState(context)?.cleanup?.();
    expect(cleaned).toBe(true);
  });
});
