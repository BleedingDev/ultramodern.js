import type { NestedRouteForCli } from '@modern-js/types';
import { describe, expect, test } from '@rstest/core';
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
});
