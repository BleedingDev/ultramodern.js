import type { AppTools, CliPlugin } from '@modern-js/app-tools';
import { createAsyncHook, createPluginManager } from '@modern-js/plugin';
import {
  createContext,
  initAppContext,
  initPluginAPI,
} from '@modern-js/plugin/cli';
import type { NestedRouteForCli } from '@modern-js/types';
import { describe, expect, test } from '@rstest/core';
import { type I18nPluginOptions, i18nPlugin } from '../src/cli';

/**
 * Localised route generation must reach a bare `appTools()` consumer.
 *
 * The fork used to register it only from `@modern-js/i18n-integration`, which
 * `ultramodernAppTools()` composes but plain `appTools()` does not — so an app
 * declaring `localeDetection.localisedUrls` got a 404 on every mapped path
 * under SSR. These cases deliberately register *only* the native plugin, with
 * no integration plugin in the manager, so a regression back to the opt-in
 * wiring fails here.
 */

const createRoute = (
  path: string,
  children?: NestedRouteForCli[],
): NestedRouteForCli => ({
  id: path,
  path,
  type: 'nested',
  origin: 'file-system',
  routeType: children ? 'layout' : 'page',
  _component: `${path}.tsx`,
  children,
});

async function createNativeOnlyHarness(options: I18nPluginOptions = {}) {
  const manager = createPluginManager();
  const routeHost: CliPlugin<AppTools> = {
    name: 'test-route-host',
    registryHooks: { modifyFileSystemRoutes: createAsyncHook<any>() },
    setup() {
      // Only supplies the hook registry the app-tools router owns.
    },
  };

  manager.addPlugins([i18nPlugin(options), routeHost]);
  const plugins = manager.getPlugins() as CliPlugin<AppTools>[];
  const context = await createContext<AppTools>({
    appContext: initAppContext({
      packageName: 'plugin-i18n-native-only-test',
      configFile: false,
      command: 'build',
      appDirectory: process.cwd(),
      metaName: 'modern-js',
      plugins,
    }),
    config: {},
    normalizedConfig: {} as any,
  });
  const api = initPluginAPI<AppTools>({ context, pluginManager: manager });
  for (const plugin of plugins) {
    await plugin.setup?.(api);
  }
  return api.getHooks().modifyFileSystemRoutes.call;
}

const entrypoint = { entryName: 'main' } as any;

const localisedUrls = {
  '/about': { en: '/about', cs: '/o-nas' },
  '/products/:slug': { en: '/products/:slug', cs: '/produkty/:slug' },
};

describe('native localised route generation', () => {
  test('expands mapped locale paths without the integration plugin', async () => {
    const modifyRoutes = await createNativeOnlyHarness({
      localeDetection: {
        localePathRedirect: true,
        languages: ['en', 'cs'],
        localisedUrls,
      },
    });

    const result = await modifyRoutes({
      entrypoint,
      routes: [
        createRoute(':lang', [
          createRoute('about'),
          createRoute('products/:slug'),
        ]),
      ],
    });

    const paths = result.routes[0].children?.map(
      (route: NestedRouteForCli) => route.path,
    );
    expect(paths).toContain('about');
    expect(paths).toContain('o-nas');
    expect(paths).toContain('products/:slug');
    expect(paths).toContain('produkty/:slug');
  });

  test('keeps one source identity for TanStack entries while validating locale mappings', async () => {
    const modifyRoutes = await createNativeOnlyHarness({
      localeDetection: {
        localePathRedirect: true,
        languages: ['en', 'cs'],
        localisedUrls,
      },
    });
    const result = await modifyRoutes({
      entrypoint: {
        ...entrypoint,
        __modernRoutesOwner: '@modern-js/plugin-tanstack',
      },
      routes: [
        createRoute(':lang', [
          createRoute('about'),
          createRoute('products/:slug'),
        ]),
      ],
    });
    expect(result.routes[0].children).toMatchObject([
      {
        id: 'about',
        path: 'about',
        modernLocalisedRoute: {
          canonicalPath: '/about',
          paths: localisedUrls['/about'],
        },
      },
      {
        id: 'products/:slug',
        path: 'products/:slug',
        modernLocalisedRoute: {
          canonicalPath: '/products/:slug',
          paths: localisedUrls['/products/:slug'],
        },
      },
    ]);
    expect(result.routes[0].children).toHaveLength(2);
  });

  test('leaves routes untouched when no map is declared', async () => {
    const modifyRoutes = await createNativeOnlyHarness({
      localeDetection: {
        localePathRedirect: true,
        languages: ['en', 'cs'],
      },
    });

    const input = [createRoute(':lang', [createRoute('about')])];
    const result = await modifyRoutes({ entrypoint, routes: input });

    expect(
      result.routes[0].children?.map((r: NestedRouteForCli) => r.path),
    ).toEqual(['about']);
  });

  test('leaves routes untouched without localePathRedirect', async () => {
    const modifyRoutes = await createNativeOnlyHarness({
      localeDetection: {
        languages: ['en', 'cs'],
        localisedUrls,
      },
    });

    const input = [createRoute(':lang', [createRoute('about')])];
    const result = await modifyRoutes({ entrypoint, routes: input });

    expect(
      result.routes[0].children?.map((r: NestedRouteForCli) => r.path),
    ).toEqual(['about']);
  });

  test('resolves the map from a per-entry locale detection override', async () => {
    const modifyRoutes = await createNativeOnlyHarness({
      localeDetection: {
        localePathRedirect: true,
        languages: ['en'],
        localeDetectionByEntry: {
          main: {
            localePathRedirect: true,
            languages: ['en', 'cs'],
            localisedUrls,
          },
        },
      },
    });

    const result = await modifyRoutes({
      entrypoint,
      routes: [createRoute(':lang', [createRoute('about')])],
    });

    expect(
      result.routes[0].children?.map((r: NestedRouteForCli) => r.path),
    ).toContain('o-nas');
  });
});
