import type { I18nUrlStrategy } from '@modern-js/plugin-i18n/runtime/no-react-i18next';
import { i18nServerPlugin } from '@modern-js/plugin-i18n/server';
import { describe, expect, test } from '@rstest/core';

function middlewareHarness(
  options: Parameters<typeof i18nServerPlugin>[0],
  routes: any[] = [{ entryName: 'main', entryPath: '', urlPath: '/' }],
  serverConfig: any = {},
) {
  const middlewares: any[] = [];
  let prepare: (() => void) | undefined;
  i18nServerPlugin(options).setup?.({
    getServerConfig: () => serverConfig,
    getServerContext: () => ({ middlewares, routes }),
    onPrepare: (fn: () => void) => {
      prepare = fn;
    },
  } as any);
  prepare?.();
  return middlewares;
}
const options = {
  localeDetection: {
    fallbackLanguage: 'en',
    languages: ['en', 'cs'],
    localePathRedirect: true,
  },
  staticRoutePrefixes: [],
};
const createContext = (pathname: string) =>
  ({
    req: {
      url: `http://localhost${pathname}`,
      header: () => ({ host: 'localhost' }),
    },
    get: () => null,
  }) as any;
const skipped = [
  '/backend-mf-manifest.json',
  '/backendRemoteEntry.cjs',
  '/mf-manifest.json',
  '/mf-stats.json',
  '/remoteEntry.js',
  '/static/app.js',
  '/upload/avatar.png',
  '/cs/static/app.js',
  '/en/upload/avatar.png',
];

describe('combined i18n server policy', () => {
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

  test('skips ADR-0002 Module Federation and static endpoints on the server', async () => {
    const middlewares = middlewareHarness(options);
    for (const pathname of skipped) {
      for (const middleware of middlewares) {
        const next = rstest.fn(async () => {});
        expect(
          await middleware.handler(createContext(pathname), next),
        ).toBeUndefined();
        expect(next).toHaveBeenCalledTimes(1);
      }
    }
  });
  test('cannot override native API and configured static exclusions', async () => {
    const permissive: I18nUrlStrategy = {
      localizePathname: () => '/wrong',
      canonicalPathname: path => path,
      shouldSkipRedirect: () => false,
    };
    const middlewares = middlewareHarness(
      {
        ...options,
        staticRoutePrefixes: ['/assets'],
        resolveUrlStrategy: () => permissive,
      },
      [
        { entryName: 'main', entryPath: '', urlPath: '/' },
        { isApi: true, urlPath: '/api' },
      ],
    );
    for (const pathname of [
      '/api/data',
      '/assets/app.js',
      '/cs/assets/app.js',
    ]) {
      for (const middleware of middlewares) {
        const next = rstest.fn(async () => {});
        expect(
          await middleware.handler(createContext(pathname), next),
        ).toBeUndefined();
        expect(next).toHaveBeenCalledTimes(1);
      }
    }
  });
  test('selects an independent strategy per entry and keeps basename/query/fragment', async () => {
    const middlewares = middlewareHarness(
      {
        ...options,
        localeDetection: {
          ...options.localeDetection,
          localisedUrls: { '/about': { en: '/about', cs: '/o-nas' } },
          localeDetectionByEntry: {
            admin: {
              localisedUrls: { '/about': { en: '/about', cs: '/sprava' } },
            },
          },
        },
      },
      [
        { entryName: 'main', entryPath: '', urlPath: '/' },
        { entryName: 'admin', entryPath: 'admin', urlPath: '/admin' },
      ],
    );
    const main = middlewares.find(
      m => m.name === 'i18n-server-middleware' && m.path === '/*',
    );
    const admin = middlewares.find(
      m => m.name === 'i18n-server-middleware' && m.path === '/admin/*',
    );
    expect(
      (
        await main.handler(createContext('/cs/about?q=1#x'), async () => {})
      ).headers.get('location'),
    ).toBe('/cs/o-nas?q=1#x');
    expect(
      (
        await admin.handler(
          createContext('/admin/cs/about?q=1#x'),
          async () => {},
        )
      ).headers.get('location'),
    ).toBe('/admin/cs/sprava?q=1#x');
  });
});
