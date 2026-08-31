import type { NestedRouteForCli } from '@modern-js/types';
import { describe, expect, test } from '@rstest/core';
import { i18nPlugin as i18nCliPlugin } from '../src/cli';
import {
  collectApiPrefixes,
  i18nServerPlugin,
  matchesApiPrefix,
} from '../src/server';

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

const createRequestContext = (pathname: string) =>
  ({
    req: {
      url: `http://localhost${pathname}`,
    },
  }) as any;

describe('cli modifyFileSystemRoutes', () => {
  test('uses the no-react runtime entry when reactI18next is disabled', () => {
    let runtimePlugin:
      | {
          path: string;
          config: Record<string, unknown>;
        }
      | undefined;

    i18nCliPlugin({ reactI18next: false }).setup({
      _internalRuntimePlugins: (fn: any) => {
        const plugins: Array<{
          path: string;
          config: Record<string, unknown>;
        }> = [];
        fn({
          entrypoint: { entryName: 'main' },
          plugins,
        });
        runtimePlugin = plugins[0];
      },
      modifyFileSystemRoutes: () => {},
      _internalServerPlugins: () => {},
      getAppContext: () => ({
        appDirectory: process.cwd(),
        metaName: 'modern-js',
      }),
      getNormalizedConfig: () => ({}),
    } as any);

    expect(runtimePlugin?.path).toBe(
      '@modern-js/plugin-i18n/runtime/no-react-i18next',
    );
    expect(runtimePlugin?.config.reactI18next).toBe(false);
  });

  const setupModifyRoutes = (localeDetection: Record<string, unknown>) => {
    let modifyRoutes:
      | ((args: { entrypoint: any; routes: any[] }) => {
          entrypoint: any;
          routes: any[];
        })
      | undefined;

    i18nCliPlugin({ localeDetection }).setup({
      _internalRuntimePlugins: () => {},
      modifyFileSystemRoutes: (fn: any) => {
        modifyRoutes = fn;
      },
      _internalServerPlugins: () => {},
    } as any);

    expect(modifyRoutes).toBeDefined();
    return modifyRoutes!;
  };

  const generateLocalisedRoutes = () => {
    const modifyRoutes = setupModifyRoutes({
      localePathRedirect: true,
      languages: ['en', 'cs', 'de'],
      localisedUrls: {
        '/about': {
          en: '/about',
          cs: '/o-nas',
          de: '/ueber-uns',
        },
        '/products': {
          en: '/products',
          cs: '/produkty',
          de: '/produkte',
        },
        '/products/:slug': {
          en: '/products/:slug',
          cs: '/produkty/:slug',
          de: '/produkte/:slug',
        },
        '/docs': {
          en: '/docs',
          cs: '/dokumenty',
          de: '/dokumente',
        },
        '/docs/*': {
          en: '/docs/*',
          cs: '/dokumenty/*',
          de: '/dokumente/*',
        },
      },
    });
    const routes = [
      createRoute(':lang', [
        createRoute('about'),
        createRoute('products', [createRoute(':slug')]),
        createRoute('docs', [createRoute('*')]),
      ]),
    ];

    const result = modifyRoutes({
      entrypoint: { entryName: 'main' },
      routes,
    });

    return result.routes;
  };

  test('creates deterministic localized aliases with canonical route identity', () => {
    const localisedRoutes = generateLocalisedRoutes();
    expect(generateLocalisedRoutes()).toEqual(localisedRoutes);

    const [localeLayout] = localisedRoutes;
    expect(localeLayout.children?.map(route => route.path)).toEqual([
      'about',
      'o-nas',
      'ueber-uns',
      'products',
      'produkty',
      'produkte',
      'docs',
      'dokumenty',
      'dokumente',
    ]);
    expect(localeLayout.children?.slice(0, 3)).toMatchObject([
      {
        _component: 'about.tsx',
        modernCanonicalPath: '/about',
        path: 'about',
      },
      {
        _component: 'about.tsx',
        modernCanonicalPath: '/about',
        path: 'o-nas',
      },
      {
        _component: 'about.tsx',
        modernCanonicalPath: '/about',
        path: 'ueber-uns',
      },
    ]);
    for (const productRoute of localeLayout.children?.slice(3, 6) ?? []) {
      expect(productRoute).toMatchObject({
        _component: 'products.tsx',
        modernCanonicalPath: '/products',
      });
      expect(productRoute.children?.[0]).toMatchObject({
        _component: ':slug.tsx',
        modernCanonicalPath: '/products/:slug',
        path: ':slug',
      });
    }
  });

  test('upstream-style configs without a map keep routes untouched', () => {
    const modifyRoutes = setupModifyRoutes({
      localePathRedirect: true,
      languages: ['en', 'cs'],
    });
    const routes = [createRoute(':lang', [createRoute('about')])];

    const result = modifyRoutes({ entrypoint: { entryName: 'main' }, routes });

    expect(result.routes).toBe(routes);
  });

  test('a configured map still expands localised route aliases', () => {
    const modifyRoutes = setupModifyRoutes({
      localePathRedirect: true,
      languages: ['en', 'cs'],
      localisedUrls: {
        '/about': { en: '/about', cs: '/o-nas' },
      },
    });
    const routes = [createRoute(':lang', [createRoute('about')])];

    const result = modifyRoutes({ entrypoint: { entryName: 'main' }, routes });

    const localeRoute = result.routes[0] as NestedRouteForCli;
    expect(localeRoute.children?.map(route => route.path)).toEqual([
      'about',
      'o-nas',
    ]);
  });
});

describe('i18n server API prefix skips', () => {
  test('collects API route prefixes and normalized BFF config prefixes', () => {
    expect(
      collectApiPrefixes(
        [
          { entryName: 'main', isApi: false, urlPath: '/' },
          { isApi: true, urlPath: '/bff-api' },
          { isApi: true, urlPath: '/rpc/*' },
          { isApi: true, urlPath: '/' },
          { isApi: true },
        ],
        ['bff-api/', '/internal-api'],
      ),
    ).toEqual(['/bff-api', '/rpc', '/internal-api']);
  });

  test('matches API prefixes by exact path or slash-delimited segment', () => {
    const prefixes = ['/bff-api'];

    expect(matchesApiPrefix('/bff-api', prefixes)).toBe(true);
    expect(matchesApiPrefix('/bff-api/ping', prefixes)).toBe(true);
    expect(matchesApiPrefix('/bff-api-v2', prefixes)).toBe(false);
    expect(matchesApiPrefix('/bff-api-v2/ping', prefixes)).toBe(false);
  });

  test('skips language detector and redirect middleware for API routes', async () => {
    const middlewares: any[] = [];
    const routes = [
      { entryName: 'main', entryPath: '', urlPath: '/' },
      { entryPath: '', isApi: true, urlPath: '/bff-api' },
    ];
    let prepare: (() => void) | undefined;

    i18nServerPlugin({
      localeDetection: {
        fallbackLanguage: 'en',
        languages: ['en', 'cs'],
        localePathRedirect: true,
      },
      staticRoutePrefixes: [],
    }).setup({
      getServerConfig: () => ({}),
      getServerContext: () => ({ middlewares, routes }),
      onPrepare: fn => {
        prepare = fn;
      },
    } as any);

    prepare?.();

    const detectorMiddleware = middlewares.find(
      middleware => middleware.name === 'i18n-language-detector',
    );
    const redirectMiddleware = middlewares.find(
      middleware => middleware.name === 'i18n-server-middleware',
    );

    expect(detectorMiddleware).toBeDefined();
    expect(redirectMiddleware).toBeDefined();

    for (const middleware of [detectorMiddleware, redirectMiddleware]) {
      let nextCalls = 0;
      const response = await middleware.handler(
        createRequestContext('/bff-api/ping'),
        async () => {
          nextCalls++;
        },
      );

      expect(response).toBeUndefined();
      expect(nextCalls).toBe(1);
    }
  });

  test('canonical redirect survives malformed percent-encoding', async () => {
    const middlewares: any[] = [];
    const routes = [{ entryName: 'main', entryPath: '', urlPath: '/' }];
    let prepare: (() => void) | undefined;

    i18nServerPlugin({
      localeDetection: {
        fallbackLanguage: 'en',
        languages: ['en', 'cs'],
        localePathRedirect: true,
        localisedUrls: {
          '/products/:slug': {
            en: '/products/:slug',
            cs: '/produkty/:slug',
          },
        },
      },
      staticRoutePrefixes: [],
    }).setup({
      getServerConfig: () => ({}),
      getServerContext: () => ({ middlewares, routes }),
      onPrepare: fn => {
        prepare = fn;
      },
    } as any);

    prepare?.();

    const redirectMiddleware = middlewares.find(
      middleware => middleware.name === 'i18n-server-middleware',
    );
    const createContext = (pathname: string) =>
      ({
        req: {
          url: `http://localhost${pathname}`,
          header: () => ({ host: 'localhost' }),
        },
        get: () => null,
      }) as any;

    // Sanity: well-formed non-canonical slugs still redirect.
    const redirected = await redirectMiddleware.handler(
      createContext('/cs/products/bota'),
      async () => {},
    );
    expect(redirected.status).toBe(302);
    expect(redirected.headers.get('location')).toBe('/cs/produkty/bota');
    expect(redirected.headers.get('cache-control')).toBe('private, no-store');
    expect(redirected.headers.get('vary')).toBe('Accept-Language, Cookie');

    // Malformed encoding must fall through to next() instead of throwing.
    let nextCalls = 0;
    const response = await redirectMiddleware.handler(
      createContext('/cs/produkty/%E0%A4%A'),
      async () => {
        nextCalls++;
      },
    );
    expect(response).toBeUndefined();
    expect(nextCalls).toBe(1);
  });

  test('uses /api as the BFF prefix when BFF config is present without prefix', async () => {
    const middlewares: any[] = [];
    const routes = [{ entryName: 'main', entryPath: '', urlPath: '/' }];
    let prepare: (() => void) | undefined;

    i18nServerPlugin({
      localeDetection: {
        fallbackLanguage: 'en',
        languages: ['en', 'cs'],
        localePathRedirect: true,
      },
      staticRoutePrefixes: [],
    }).setup({
      getServerConfig: () => ({ bff: {} }),
      getServerContext: () => ({ middlewares, routes }),
      onPrepare: fn => {
        prepare = fn;
      },
    } as any);

    prepare?.();

    const redirectMiddleware = middlewares.find(
      middleware => middleware.name === 'i18n-server-middleware',
    );

    let nextCalls = 0;
    const response = await redirectMiddleware.handler(
      createRequestContext('/api/ping'),
      async () => {
        nextCalls++;
      },
    );

    expect(response).toBeUndefined();
    expect(nextCalls).toBe(1);
  });
});
