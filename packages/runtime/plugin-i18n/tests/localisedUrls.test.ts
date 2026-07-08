import type { NestedRouteForCli } from '@modern-js/types';
import { describe, expect, test } from '@rstest/core';
import { i18nPlugin as i18nCliPlugin } from '../src/cli';
import {
  collectApiPrefixes,
  i18nServerPlugin,
  matchesApiPrefix,
} from '../src/server';
import {
  applyLocalisedUrlsToRoutes,
  canonicalTargetPathname,
  localiseTargetPathname,
  matchPathPattern,
  resolveCanonicalLocalisedPath,
  resolveLocalisedPath,
  resolveLocalisedUrlsConfig,
  validateLocalisedUrls,
} from '../src/shared/localisedUrls';

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

describe('resolveLocalisedUrlsConfig', () => {
  test('is opt-in: only a non-empty map enables the feature', () => {
    const map = { '/about': { en: '/about', cs: '/o-nas' } };
    expect(resolveLocalisedUrlsConfig(map)).toEqual({ enabled: true, map });
  });

  test('absent, boolean and empty-map options resolve to disabled', () => {
    const disabled = { enabled: false, map: {} };
    expect(resolveLocalisedUrlsConfig(undefined)).toEqual(disabled);
    expect(resolveLocalisedUrlsConfig(false)).toEqual(disabled);
    expect(resolveLocalisedUrlsConfig(true)).toEqual(disabled);
    expect(resolveLocalisedUrlsConfig({})).toEqual(disabled);
  });
});

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

describe('localisedUrls', () => {
  test('requires every localisable route path to define every language', () => {
    const routes = [createRoute(':lang', [createRoute('terms-of-service')])];

    expect(() =>
      validateLocalisedUrls(routes, ['en', 'cs'], {
        '/terms-of-service': {
          en: '/terms-of-service',
        },
      }),
    ).toThrow('missing languages: cs');
  });

  test('expands route paths to localised aliases', () => {
    const routes = [
      createRoute(':lang', [
        createRoute('terms-of-service'),
        createRoute('products', [createRoute(':slug')]),
      ]),
    ];

    const localisedRoutes = applyLocalisedUrlsToRoutes(routes, ['en', 'cs'], {
      '/terms-of-service': {
        en: '/terms-of-service',
        cs: '/podminky-pouzivani',
      },
      '/products': {
        en: '/products',
        cs: '/produkty',
      },
      '/products/:slug': {
        en: '/products/:slug',
        cs: '/produkty/:slug',
      },
    });

    const localeRoute = localisedRoutes[0] as NestedRouteForCli;
    expect(localeRoute.children?.map(route => route.path)).toEqual([
      'terms-of-service',
      'podminky-pouzivani',
      'products',
      'produkty',
    ]);

    const productRoutes = localeRoute.children?.filter(
      route => route.path === 'products' || route.path === 'produkty',
    );
    expect(productRoutes?.[0].children?.map(route => route.path)).toEqual([
      ':slug',
    ]);
    expect(productRoutes?.[1].children?.map(route => route.path)).toEqual([
      ':slug',
    ]);
  });

  test('expands flat locale-prefixed route paths with canonical keys', () => {
    const routes = [
      createRoute('/:lang/about'),
      createRoute('/:lang/products/:slug'),
    ];

    const localisedRoutes = applyLocalisedUrlsToRoutes(routes, ['en', 'cs'], {
      '/about': {
        en: '/about',
        cs: '/o-nas',
      },
      '/products/:slug': {
        en: '/products/:slug',
        cs: '/produkty/:slug',
      },
    });

    expect(localisedRoutes.map(route => route.path)).toEqual([
      ':lang/about',
      ':lang/o-nas',
      ':lang/products/:slug',
      ':lang/produkty/:slug',
    ]);
  });

  test('resolves current localized path to the target language', () => {
    const localisedUrls = {
      '/terms-of-service': {
        en: '/terms-of-service',
        cs: '/podminky-pouzivani',
      },
      '/products/:slug': {
        en: '/products/:slug',
        cs: '/produkty/:slug',
      },
    };

    expect(
      resolveLocalisedPath(
        '/terms-of-service',
        'cs',
        ['en', 'cs'],
        localisedUrls,
      ),
    ).toBe('/podminky-pouzivani');
    expect(
      resolveLocalisedPath('/produkty/cervena-bota', 'en', ['en', 'cs'], {
        ...localisedUrls,
        '/products/:slug': {
          en: '/products/:slug',
          cs: '/produkty/:slug',
        },
      }),
    ).toBe('/products/cervena-bota');
  });

  test('resolves optional route params', () => {
    const localisedUrls = {
      '/products/:slug?': {
        en: '/products/:slug?',
        cs: '/produkty/:slug?',
      },
    };

    expect(
      resolveLocalisedPath('/products', 'cs', ['en', 'cs'], localisedUrls),
    ).toBe('/produkty');
    expect(
      resolveLocalisedPath(
        '/produkty/cervena-bota',
        'en',
        ['en', 'cs'],
        localisedUrls,
      ),
    ).toBe('/products/cervena-bota');
  });

  test('encodes wildcard params while preserving path separators', () => {
    const localisedUrls = {
      '/docs/*': {
        en: '/docs/*',
        cs: '/dokumenty/*',
      },
    };

    expect(
      resolveLocalisedPath(
        '/docs/a%20b/c%23d',
        'cs',
        ['en', 'cs'],
        localisedUrls,
      ),
    ).toBe('/dokumenty/a%20b/c%23d');
    expect(
      resolveCanonicalLocalisedPath(
        '/dokumenty/a%20b/c%23d',
        ['en', 'cs'],
        localisedUrls,
      ),
    ).toBe('/docs/a%20b/c%23d');
  });

  test('resolves static patterns before param patterns', () => {
    const localisedUrls = {
      '/products/:slug': {
        en: '/products/:slug',
        cs: '/produkty/:slug',
      },
      '/products/new': {
        en: '/products/new',
        cs: '/produkty/novinka',
      },
    };

    expect(
      resolveLocalisedPath('/products/new', 'cs', ['en', 'cs'], localisedUrls),
    ).toBe('/produkty/novinka');
    expect(
      resolveCanonicalLocalisedPath(
        '/produkty/novinka',
        ['en', 'cs'],
        localisedUrls,
      ),
    ).toBe('/products/new');
  });

  test('localises and canonicalises full target pathnames through one helper', () => {
    const localisedUrls = {
      '/products/:slug': {
        en: '/products/:slug',
        cs: '/produkty/:slug',
      },
    };

    expect(
      localiseTargetPathname(
        '/en/products/cervena-bota',
        'cs',
        ['en', 'cs'],
        localisedUrls,
      ),
    ).toBe('/cs/produkty/cervena-bota');
    expect(
      canonicalTargetPathname(
        '/cs/produkty/cervena-bota',
        ['en', 'cs'],
        localisedUrls,
      ),
    ).toBe('/products/cervena-bota');
  });

  test('strips case-insensitive locale prefixes before relocalising full pathnames', () => {
    const localisedUrls = {
      '/products/:slug': {
        en: '/products/:slug',
        cs: '/produkty/:slug',
      },
    };

    expect(
      localiseTargetPathname(
        '/CS/produkty/cervena-bota',
        'en',
        ['en', 'cs'],
        localisedUrls,
      ),
    ).toBe('/en/products/cervena-bota');
    expect(
      canonicalTargetPathname(
        '/CS/produkty/cervena-bota',
        ['en', 'cs'],
        localisedUrls,
      ),
    ).toBe('/products/cervena-bota');
  });

  test('resolves nested optional route params with translated ancestors', () => {
    const localisedUrls = {
      '/checkout': {
        en: '/checkout',
        cs: '/pokladna',
      },
      '/checkout/thank-you': {
        en: '/checkout/thank-you',
        cs: '/pokladna/dekujeme',
      },
      '/checkout/thank-you/:orderId?': {
        en: '/checkout/thank-you/:orderId?',
        cs: '/pokladna/dekujeme/:orderId?',
      },
    };

    expect(
      resolveLocalisedPath(
        '/checkout/thank-you',
        'cs',
        ['en', 'cs'],
        localisedUrls,
      ),
    ).toBe('/pokladna/dekujeme');
    expect(
      resolveLocalisedPath(
        '/pokladna/dekujeme/ABC-123',
        'en',
        ['en', 'cs'],
        localisedUrls,
      ),
    ).toBe('/checkout/thank-you/ABC-123');
  });
});

describe('matchPathPattern decoding', () => {
  test('decodes valid percent-encoded params', () => {
    expect(
      matchPathPattern('/produkty/%C4%8Derven%C3%A1', '/produkty/:slug'),
    ).toEqual({ slug: 'červená' });
  });

  test('treats malformed percent-encoding as no match instead of throwing', () => {
    expect(() =>
      matchPathPattern('/produkty/%E0%A4%A', '/produkty/:slug'),
    ).not.toThrow();
    expect(
      matchPathPattern('/produkty/%E0%A4%A', '/produkty/:slug'),
    ).toBeNull();
  });

  test('keeps literal bracket segments in pathnames (no pattern rewrite)', () => {
    expect(matchPathPattern('/produkty/[x]', '/produkty/:slug')).toEqual({
      slug: '[x]',
    });
  });

  test('resolveLocalisedPath returns malformed paths unchanged', () => {
    const localisedUrls = {
      '/products/:slug': {
        en: '/products/:slug',
        cs: '/produkty/:slug',
      },
    };

    expect(
      resolveLocalisedPath(
        '/produkty/%E0%A4%A',
        'en',
        ['en', 'cs'],
        localisedUrls,
      ),
    ).toBe('/produkty/%E0%A4%A');
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
