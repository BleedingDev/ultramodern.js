import { describe, expect, test } from '@rstest/core';
import type { LocalisedRoute } from '../src/localisedUrls/index';
import {
  applyLocalisedUrlsToRoutes,
  canonicalTargetPathname,
  localiseTargetPathname,
  matchPathPattern,
  resolveCanonicalLocalisedPath,
  resolveLocalisedPath,
  resolveLocalisedUrlsConfig,
  validateLocalisedUrls,
} from '../src/localisedUrls/index';

const createRoute = (
  path: string,
  children?: LocalisedRoute[],
): LocalisedRoute => ({
  id: path,
  path,
  type: 'nested',
  origin: 'file-system',
  routeType: children ? 'layout' : 'page',
  _component: `${path}.tsx`,
  children,
});

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

describe('localisedUrls', () => {
  test('leaves framework-internal Module Federation routes unlocalised', () => {
    const internalRoute = createRoute('_mf', [
      createRoute('fragment', [createRoute('product-card')]),
    ]);
    const publicRoute = createRoute(':lang', [createRoute('products')]);
    const routes = [internalRoute, publicRoute];

    expect(() =>
      validateLocalisedUrls(routes, ['en', 'cs'], {
        '/products': { en: '/products', cs: '/produkty' },
      }),
    ).not.toThrow();
    expect(
      applyLocalisedUrlsToRoutes(routes, ['en', 'cs'], {
        '/products': { en: '/products', cs: '/produkty' },
      })[0],
    ).toEqual(internalRoute);
  });

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

  test('requires canonical and localised patterns to keep the same parameter signature', () => {
    const routes = [createRoute('/:lang/products/:slug')];

    expect(() =>
      validateLocalisedUrls(routes, ['en', 'cs'], {
        '/products/:slug': {
          en: '/products/:slug',
          cs: '/produkty/:produkt',
        },
      }),
    ).toThrow(
      'localisedUrls["/products/:slug"].cs must use the same parameter signature',
    );
  });

  test('allows locales to reorder the same named parameters', () => {
    const routes = [createRoute('/:lang/catalog/:category/:slug')];
    const localisedUrls = {
      '/catalog/:category/:slug': {
        en: '/catalog/:category/:slug',
        cs: '/katalog/:slug/kategorie/:category',
      },
    };

    expect(() =>
      validateLocalisedUrls(routes, ['en', 'cs'], localisedUrls),
    ).not.toThrow();
    expect(
      resolveLocalisedPath(
        '/catalog/shoes/red',
        'cs',
        ['en', 'cs'],
        localisedUrls,
      ),
    ).toBe('/katalog/red/kategorie/shoes');
  });

  test('rejects reordering optional parameters whose position affects matching', () => {
    const routes = [createRoute('/:lang/catalog/:category?/:slug?')];

    expect(() =>
      validateLocalisedUrls(routes, ['en', 'cs'], {
        '/catalog/:category?/:slug?': {
          en: '/catalog/:category?/:slug?',
          cs: '/katalog/:slug?/:category?',
        },
      }),
    ).toThrow('must keep optional and splat parameters in canonical order');
  });

  test('allows languages of one canonical route to share a physical alias', () => {
    const routes = [createRoute('/:lang/about')];

    expect(
      applyLocalisedUrlsToRoutes(routes, ['en', 'cs'], {
        '/about': {
          en: '/about',
          cs: '/about',
        },
      }).map(route => route.path),
    ).toEqual([':lang/about']);
  });

  test('rejects distinct canonical routes that generate the same physical path', () => {
    const routes = [
      createRoute('/:lang/products/:slug'),
      createRoute('/:lang/articles/:article'),
    ];

    expect(() =>
      validateLocalisedUrls(routes, ['en', 'cs'], {
        '/products/:slug': {
          en: '/catalog/:slug',
          cs: '/produkty/:slug',
        },
        '/articles/:article': {
          en: '/catalog/:article',
          cs: '/clanky/:article',
        },
      }),
    ).toThrow('generate the same physical route pattern');
  });

  test('rejects an alias owned by another route canonical pattern', () => {
    const routes = [createRoute('/:lang/about'), createRoute('/:lang/company')];

    expect(() =>
      validateLocalisedUrls(routes, ['en', 'cs'], {
        '/about': {
          en: '/about-en',
          cs: '/about-cs',
        },
        '/company': {
          en: '/company-en',
          cs: '/about',
        },
      }),
    ).toThrow('generate the same physical route pattern "/about"');
  });

  test('rejects equal-specificity aliases that can match the same path', () => {
    const routes = [
      createRoute('/:lang/alpha/:slug'),
      createRoute('/:lang/beta/:section'),
    ];

    expect(() =>
      validateLocalisedUrls(routes, ['en', 'cs'], {
        '/alpha/:slug': {
          en: '/x/:slug',
          cs: '/alfa/:slug',
        },
        '/beta/:section': {
          en: '/:section/y',
          cs: '/beta/:section',
        },
      }),
    ).toThrow('overlapping route patterns');
  });

  test('disambiguates lossy route ID suffixes without rejecting valid URLs', () => {
    const routes = [createRoute('/:lang/about')];
    const localisedUrls = {
      '/about': {
        en: '/about',
        cs: '/o.nas',
        de: '/o_nas',
      },
    };

    const localisedRoutes = applyLocalisedUrlsToRoutes(
      routes,
      ['en', 'cs', 'de'],
      localisedUrls,
    );

    expect(
      applyLocalisedUrlsToRoutes(routes, ['en', 'cs', 'de'], localisedUrls),
    ).toEqual(localisedRoutes);
    expect(localisedRoutes.map(route => route.path)).toEqual([
      ':lang/about',
      ':lang/o.nas',
      ':lang/o_nas',
    ]);
    expect(new Set(localisedRoutes.map(route => route.id)).size).toBe(3);
  });

  test('rejects a generated route ID that collides with an existing route', () => {
    const collidingRoute = {
      ...createRoute('_mf/health'),
      id: '/:lang/about__localised_lang_o_nas',
    };

    expect(() =>
      applyLocalisedUrlsToRoutes(
        [createRoute('/:lang/about'), collidingRoute],
        ['en', 'cs'],
        {
          '/about': {
            en: '/about',
            cs: '/o.nas',
          },
        },
      ),
    ).toThrow('generated duplicate route ID');
  });

  test('rejects duplicate params and non-terminal splats', () => {
    expect(() =>
      validateLocalisedUrls(
        [createRoute('/:lang/pairs/:id/:id')],
        ['en', 'cs'],
        {
          '/pairs/:id/:id': {
            en: '/pairs/:id/:id',
            cs: '/dvojice/:id/:id',
          },
        },
      ),
    ).toThrow('duplicate path parameter ":id"');

    expect(() =>
      validateLocalisedUrls([createRoute('/:lang/docs/*/edit')], ['en', 'cs'], {
        '/docs/*/edit': {
          en: '/docs/*/edit',
          cs: '/dokumenty/*/upravit',
        },
      }),
    ).toThrow('splat parameter "*" must be the final segment');
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

    const localeRoute = localisedRoutes[0] as LocalisedRoute;
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

  test('empty splats round-trip and exact static routes keep precedence', () => {
    expect(matchPathPattern('/docs', '/docs/*')).toEqual({ '*': '' });
    expect(
      resolveLocalisedPath('/docs', 'cs', ['en', 'cs'], {
        '/docs/*': {
          en: '/docs/*',
          cs: '/dokumenty/*',
        },
      }),
    ).toBe('/dokumenty');

    expect(
      resolveLocalisedPath('/docs', 'cs', ['en', 'cs'], {
        '/docs/*': {
          en: '/docs/*',
          cs: '/dokumenty/*',
        },
        '/docs': {
          en: '/docs',
          cs: '/dokumenty-domu',
        },
      }),
    ).toBe('/dokumenty-domu');
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

  test('reverse resolution is deterministic for equally specific matches', () => {
    const firstOrder = {
      '/z/:slug': {
        en: '/x/:slug',
        cs: '/z/:slug',
      },
      '/a/:section': {
        en: '/:section/y',
        cs: '/a/:section',
      },
    };
    const reverseOrder = {
      '/a/:section': firstOrder['/a/:section'],
      '/z/:slug': firstOrder['/z/:slug'],
    };

    expect(
      resolveCanonicalLocalisedPath('/x/y', ['en', 'cs'], firstOrder),
    ).toBe('/a/x');
    expect(
      resolveCanonicalLocalisedPath('/x/y', ['en', 'cs'], reverseOrder),
    ).toBe('/a/x');
  });

  test('reverse resolution prefers the most specific localised source pattern', () => {
    const localisedUrls = {
      '/catalog/:section/:item/:detail': {
        en: '/:section/:item/:detail',
        cs: '/katalog/:section/:item/:detail',
      },
      '/:category/:slug': {
        en: '/store/:category/:slug',
        cs: '/obchod/:category/:slug',
      },
    };

    expect(
      resolveCanonicalLocalisedPath(
        '/store/shoes/red',
        ['en', 'cs'],
        localisedUrls,
      ),
    ).toBe('/shoes/red');
  });

  test('a specific localised source outranks a broad canonical source', () => {
    const localisedUrls = {
      '/:section/:slug': {
        en: '/generic/:section/:slug',
        cs: '/obecne/:section/:slug',
      },
      '/products/:id': {
        en: '/fixed/:id',
        cs: '/produkty/:id',
      },
    };

    expect(
      resolveCanonicalLocalisedPath('/fixed/red', ['en', 'cs'], localisedUrls),
    ).toBe('/products/red');
  });

  test('missing required target params never collapse into empty segments', () => {
    expect(() =>
      resolveLocalisedPath('/products/red-shoe', 'cs', ['en', 'cs'], {
        '/products/:slug': {
          en: '/products/:slug',
          cs: '/produkty/:product',
        },
      }),
    ).toThrow('Missing required path parameter "product"');

    expect(() =>
      resolveLocalisedPath('/products/red-shoe', 'cs', ['en', 'cs'], {
        '/products/:slug': {
          en: '/products/:slug',
          cs: '/produkty/:toString',
        },
      }),
    ).toThrow('Missing required path parameter "toString"');
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
  test('keeps prototype-named params as ordinary own values', () => {
    const params = matchPathPattern('/products/red', '/products/:__proto__');

    expect(params && Object.hasOwn(params, '__proto__')).toBe(true);
    expect(
      params && Object.getOwnPropertyDescriptor(params, '__proto__')?.value,
    ).toBe('red');
  });

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
