import type { NestedRouteForCli } from '@modern-js/types';
import { describe, expect, test } from '@rstest/core';
import {
  collectApiPrefixes,
  i18nServerPlugin,
  matchesApiPrefix,
} from '../src/server';
import {
  applyLocalisedUrlsToRoutes,
  resolveLocalisedPath,
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
