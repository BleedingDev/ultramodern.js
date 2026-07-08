import { InternalRuntimeContext } from '@modern-js/runtime/context';
import type React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ModernI18nProvider } from '../src/runtime/context';
import type { I18nInstance } from '../src/runtime/i18n';
import { detectLanguageWithPriority } from '../src/runtime/i18n/detection';
import { interpolateRouteParams, Link } from '../src/runtime/Link';
import {
  canonicalPath,
  localizePath,
  useLocalizedLocation,
} from '../src/runtime/localizedPaths';
import { buildLocalizedUrl, splitUrlTarget } from '../src/runtime/utils';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const localisedUrls = {
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
  // Canonical key that matches no language pattern.
  '/talks/:slug': {
    en: '/lectures/:slug',
    cs: '/prednasky/:slug',
  },
};

const languages = ['en', 'cs'];
const pathsConfig = { languages, localisedUrls };

const requestContext = {
  request: {},
  response: {},
};

const capturedLinkProps: any[] = [];

// Mirrors the real TanStack Link contract: it consumes its own props
// (`preload`, `search`, `hash`, ...) and spreads everything else onto the
// anchor. Deliberately does NOT strip `prefetch` — TanStack has no such prop,
// so a forwarded `prefetch` would leak into the DOM and fail assertions.
const TanstackLink = ({ to, children, ...props }: any) => {
  capturedLinkProps.push({ to, ...props });
  const {
    preload: _preload,
    search: _search,
    hash: _hash,
    hashScrollIntoView: _hashScrollIntoView,
    replace: _replace,
    ...anchorProps
  } = props;

  return (
    <a href={to} data-router-link="tanstack" {...anchorProps}>
      {children}
    </a>
  );
};

function createI18nInstance(language = 'en'): I18nInstance {
  return {
    language,
    isInitialized: true,
    init: () => Promise.resolve(undefined),
    use: () => {},
    createInstance: () => createI18nInstance(language),
    services: {},
    options: {},
  };
}

function createTanstackRouter(target = '/en/terms-of-service', lang = 'en') {
  const url = new URL(target, 'https://modernjs.test');

  return {
    navigate: rstest.fn(async () => undefined),
    state: {
      location: {
        pathname: url.pathname,
        searchStr: url.search,
        hash: url.hash,
      },
      matches: [{ params: { lang } }],
    },
  };
}

function createTanstackRuntimeContext(router: unknown) {
  return {
    isBrowser: true,
    requestContext,
    context: requestContext,
    routerFramework: 'tanstack',
    routerInstance: router,
    routerRuntime: {
      framework: 'tanstack',
      instance: router,
    },
    router: {
      Link: TanstackLink,
      useRouter: () => router,
    },
  } as any;
}

function providerValue(language: string) {
  return {
    language,
    i18nInstance: createI18nInstance(language),
    languages,
    localePathRedirect: true,
    localisedUrls,
  };
}

async function renderWithRuntime(node: React.ReactNode, runtimeContext: any) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <InternalRuntimeContext.Provider value={runtimeContext}>
        {node}
      </InternalRuntimeContext.Provider>,
    );
  });

  return { container, root };
}

function cleanup(rendered?: { container: HTMLElement; root: Root }) {
  if (!rendered) {
    return;
  }
  act(() => {
    rendered.root.unmount();
  });
  rendered.container.remove();
}

describe('splitUrlTarget', () => {
  test('splits pathname, search and hash', () => {
    expect(splitUrlTarget('/talks?tag=x#abstract')).toEqual({
      pathname: '/talks',
      search: '?tag=x',
      hash: '#abstract',
    });
    expect(splitUrlTarget('/#work-with-me')).toEqual({
      pathname: '/',
      search: '',
      hash: '#work-with-me',
    });
    expect(splitUrlTarget('/talks')).toEqual({
      pathname: '/talks',
      search: '',
      hash: '#'.slice(1) === '' ? '' : '',
    });
    expect(splitUrlTarget('?q=1#x')).toEqual({
      pathname: '',
      search: '?q=1',
      hash: '#x',
    });
  });
});

describe('buildLocalizedUrl suffix handling', () => {
  test('hash-only target keeps the hash and drops the trailing slash', () => {
    expect(buildLocalizedUrl('/#work-with-me', 'en', languages)).toBe(
      '/en#work-with-me',
    );
  });

  test('query-only target keeps the query', () => {
    expect(buildLocalizedUrl('/products?tag=x', 'en', languages)).toBe(
      '/en/products?tag=x',
    );
  });

  test('query and hash survive localized slug mapping', () => {
    expect(
      buildLocalizedUrl(
        '/products/bota?tag=x#detail',
        'cs',
        languages,
        localisedUrls,
      ),
    ).toBe('/cs/produkty/bota?tag=x#detail');
  });

  test('root path', () => {
    expect(buildLocalizedUrl('/', 'cs', languages, localisedUrls)).toBe('/cs');
  });

  test('localizes canonical keys that match no language pattern', () => {
    expect(
      buildLocalizedUrl(
        '/talks/ai-slop#abstract',
        'cs',
        languages,
        localisedUrls,
      ),
    ).toBe('/cs/prednasky/ai-slop#abstract');
    expect(
      buildLocalizedUrl('/talks/ai-slop', 'en', languages, localisedUrls),
    ).toBe('/en/lectures/ai-slop');
  });

  test('re-localizes already-localized paths', () => {
    expect(
      buildLocalizedUrl('/cs/produkty/bota#x', 'en', languages, localisedUrls),
    ).toBe('/en/products/bota#x');
  });
});

describe('interpolateRouteParams', () => {
  test('interpolates $param and :param segments', () => {
    expect(interpolateRouteParams('/talks/$slug', { slug: 'ai slop' })).toBe(
      '/talks/ai%20slop',
    );
    expect(interpolateRouteParams('/talks/:slug', { slug: 'x' })).toBe(
      '/talks/x',
    );
  });

  test('drops missing optional segments', () => {
    expect(interpolateRouteParams('/opt/{-$slug}', {})).toBe('/opt');
    expect(interpolateRouteParams('/opt/:slug?', {})).toBe('/opt');
    expect(interpolateRouteParams('/opt/{-$slug}', { slug: 'v' })).toBe(
      '/opt/v',
    );
  });

  test('expands splat params', () => {
    expect(interpolateRouteParams('/files/$', { _splat: 'a/b' })).toBe(
      '/files/a/b',
    );
    expect(interpolateRouteParams('/files/*', { '*': 'a' })).toBe('/files/a');
  });
});

describe('localization utilities', () => {
  test('localizePath maps canonical paths per language', () => {
    expect(localizePath('/products/bota', 'cs', pathsConfig)).toBe(
      '/cs/produkty/bota',
    );
    expect(localizePath('/talks/x', 'en', pathsConfig)).toBe('/en/lectures/x');
  });

  test('canonicalPath strips language and reverse-maps localized slugs', () => {
    expect(canonicalPath('/cs/produkty/bota', pathsConfig)).toBe(
      '/products/bota',
    );
    expect(canonicalPath('/en/lectures/x?q=1#h', pathsConfig)).toBe(
      '/talks/x?q=1#h',
    );
    expect(canonicalPath('/cs', pathsConfig)).toBe('/');
    expect(canonicalPath('/en/products', pathsConfig)).toBe('/products');
  });
});

describe('language detection priority', () => {
  test('path locale overrides stale SSR data', async () => {
    const previousSsrData = (window as any)._SSR_DATA;
    (window as any)._SSR_DATA = { data: { i18nData: { lng: 'en' } } };

    try {
      await expect(
        detectLanguageWithPriority(createI18nInstance('en'), {
          languages,
          fallbackLanguage: 'en',
          localePathRedirect: true,
          i18nextDetector: false,
          detection: {},
          userInitOptions: {},
          pathname: '/cs/produkty',
          ssrContext: undefined,
        }),
      ).resolves.toEqual({ detectedLanguage: 'cs', finalLanguage: 'cs' });
    } finally {
      if (previousSsrData === undefined) {
        delete (window as any)._SSR_DATA;
      } else {
        (window as any)._SSR_DATA = previousSsrData;
      }
    }
  });

  test('regional SSR language resolves to supported base language', async () => {
    const previousSsrData = (window as any)._SSR_DATA;
    (window as any)._SSR_DATA = { data: { i18nData: { lng: 'en-US' } } };

    try {
      await expect(
        detectLanguageWithPriority(createI18nInstance('cs'), {
          languages,
          fallbackLanguage: 'cs',
          localePathRedirect: true,
          i18nextDetector: false,
          detection: {},
          userInitOptions: {},
          pathname: '/products',
          ssrContext: undefined,
        }),
      ).resolves.toEqual({ detectedLanguage: 'en', finalLanguage: 'en' });
    } finally {
      if (previousSsrData === undefined) {
        delete (window as any)._SSR_DATA;
      } else {
        (window as any)._SSR_DATA = previousSsrData;
      }
    }
  });
});

describe('framework Link', () => {
  let rendered: { container: HTMLElement; root: Root } | undefined;

  afterEach(() => {
    cleanup(rendered);
    rendered = undefined;
    capturedLinkProps.length = 0;
  });

  test('localizes canonical paths through the TanStack Link', async () => {
    const router = createTanstackRouter('/cs/podminky-pouzivani', 'cs');
    rendered = await renderWithRuntime(
      <ModernI18nProvider value={providerValue('cs')}>
        <Link to="/products/$slug" params={{ slug: 'bota' }} data-testid="p">
          Product
        </Link>
      </ModernI18nProvider>,
      createTanstackRuntimeContext(router),
    );

    const link = rendered.container.querySelector('[data-testid="p"]');
    expect(link?.getAttribute('href')).toBe('/cs/produkty/bota');
    expect(link?.getAttribute('data-router-link')).toBe('tanstack');
  });

  test('passes hash natively for cross-page hash targets', async () => {
    const router = createTanstackRouter('/cs/podminky-pouzivani', 'cs');
    rendered = await renderWithRuntime(
      <ModernI18nProvider value={providerValue('cs')}>
        <Link to="/#work-with-me" data-testid="cta">
          CTA
        </Link>
      </ModernI18nProvider>,
      createTanstackRuntimeContext(router),
    );

    const props = capturedLinkProps.at(-1);
    expect(props.to).toBe('/cs');
    expect(props.hash).toBe('work-with-me');
  });

  test('passes query and hash from the target natively', async () => {
    const router = createTanstackRouter('/en/products', 'en');
    rendered = await renderWithRuntime(
      <ModernI18nProvider value={providerValue('en')}>
        <Link to="/products?tag=x#list" data-testid="q">
          Products
        </Link>
      </ModernI18nProvider>,
      createTanstackRuntimeContext(router),
    );

    const props = capturedLinkProps.at(-1);
    expect(props.to).toBe('/en/products');
    expect(props.search).toEqual({ tag: 'x' });
    expect(props.hash).toBe('list');
  });

  test('preserves array search values natively', async () => {
    const router = createTanstackRouter('/en/products', 'en');
    rendered = await renderWithRuntime(
      <ModernI18nProvider value={providerValue('en')}>
        <Link
          to="/products"
          search={{ tag: ['boots', 'sale'], page: 2 }}
          data-testid="q"
        >
          Products
        </Link>
      </ModernI18nProvider>,
      createTanstackRuntimeContext(router),
    );

    const props = capturedLinkProps.at(-1);
    expect(props.to).toBe('/en/products');
    expect(props.search).toEqual({ tag: ['boots', 'sale'], page: '2' });
  });

  test('renders a plain anchor for external targets', async () => {
    const router = createTanstackRouter('/en', 'en');
    rendered = await renderWithRuntime(
      <ModernI18nProvider value={providerValue('en')}>
        <Link to="https://ai.bleeding.dev" data-testid="ext" prefetch="none">
          AI
        </Link>
      </ModernI18nProvider>,
      createTanstackRuntimeContext(router),
    );

    const link = rendered.container.querySelector('[data-testid="ext"]');
    expect(link?.getAttribute('href')).toBe('https://ai.bleeding.dev');
    expect(link?.getAttribute('data-router-link')).toBeNull();
    expect(link?.hasAttribute('prefetch')).toBe(false);
  });

  test('renders a plain anchor for same-page hash targets', async () => {
    const router = createTanstackRouter('/en', 'en');
    rendered = await renderWithRuntime(
      <ModernI18nProvider value={providerValue('en')}>
        <Link to="#work-with-me" data-testid="anchor">
          Jump
        </Link>
      </ModernI18nProvider>,
      createTanstackRuntimeContext(router),
    );

    const link = rendered.container.querySelector('[data-testid="anchor"]');
    expect(link?.getAttribute('href')).toBe('#work-with-me');
    expect(link?.getAttribute('data-router-link')).toBeNull();
  });

  test('falls back to a localized anchor without a router', async () => {
    rendered = await renderWithRuntime(
      <ModernI18nProvider value={providerValue('cs')}>
        <Link
          to="/products/$slug?tag=x#detail"
          params={{ slug: 'bota' }}
          data-testid="f"
          prefetch="viewport"
        >
          Product
        </Link>
      </ModernI18nProvider>,
      { isBrowser: true, requestContext, context: requestContext } as any,
    );

    const link = rendered.container.querySelector('[data-testid="f"]');
    expect(link?.getAttribute('href')).toBe('/cs/produkty/bota?tag=x#detail');
    expect(link?.hasAttribute('prefetch')).toBe(false);
  });

  test('serializes array search values for fallback anchors', async () => {
    rendered = await renderWithRuntime(
      <ModernI18nProvider value={providerValue('en')}>
        <Link
          to="/products"
          search={{ tag: ['boots', 'sale'], page: 2 }}
          data-testid="q"
        >
          Products
        </Link>
      </ModernI18nProvider>,
      { isBrowser: true, requestContext, context: requestContext } as any,
    );

    const link = rendered.container.querySelector('[data-testid="q"]');
    expect(link?.getAttribute('href')).toBe(
      '/en/products?tag=boots&tag=sale&page=2',
    );
  });

  test('empty search prop clears query from target fallback anchors', async () => {
    rendered = await renderWithRuntime(
      <ModernI18nProvider value={providerValue('en')}>
        <Link to="/products?tag=x" search="" data-testid="clear-query">
          Products
        </Link>
      </ModernI18nProvider>,
      { isBrowser: true, requestContext, context: requestContext } as any,
    );

    const link = rendered.container.querySelector(
      '[data-testid="clear-query"]',
    );
    expect(link?.getAttribute('href')).toBe('/en/products');
  });

  test('maps prefetch to the TanStack preload prop', async () => {
    const router = createTanstackRouter('/en/products', 'en');
    rendered = await renderWithRuntime(
      <ModernI18nProvider value={providerValue('en')}>
        <Link to="/products" data-testid="pf" prefetch="intent">
          Products
        </Link>
      </ModernI18nProvider>,
      createTanstackRuntimeContext(router),
    );

    const props = capturedLinkProps.at(-1);
    expect(props.preload).toBe('intent');
    expect(props.prefetch).toBeUndefined();

    const link = rendered.container.querySelector('[data-testid="pf"]');
    expect(link?.hasAttribute('prefetch')).toBe(false);
  });

  test('maps prefetch="none" to preload={false}; explicit preload wins', async () => {
    const router = createTanstackRouter('/en/products', 'en');
    rendered = await renderWithRuntime(
      <ModernI18nProvider value={providerValue('en')}>
        <Link to="/products" data-testid="none" prefetch="none">
          Products
        </Link>
        <Link
          to="/products"
          data-testid="explicit"
          prefetch="intent"
          preload="viewport"
        >
          Products
        </Link>
      </ModernI18nProvider>,
      createTanstackRuntimeContext(router),
    );

    const noneProps = capturedLinkProps[capturedLinkProps.length - 2];
    expect(noneProps.preload).toBe(false);
    expect(noneProps.prefetch).toBeUndefined();

    const explicitProps = capturedLinkProps.at(-1);
    expect(explicitProps.preload).toBe('viewport');
    expect(explicitProps.prefetch).toBeUndefined();
  });

  test('marks the canonical target active on any localized variant', async () => {
    const router = createTanstackRouter('/cs/podminky-pouzivani', 'cs');
    rendered = await renderWithRuntime(
      <ModernI18nProvider value={providerValue('cs')}>
        <Link
          to="/terms-of-service"
          data-testid="active-link"
          activeProps={{ className: 'is-active' }}
          className="nav"
        >
          Terms
        </Link>
        <Link to="/products" data-testid="inactive-link">
          Products
        </Link>
      </ModernI18nProvider>,
      createTanstackRuntimeContext(router),
    );

    const active = rendered.container.querySelector(
      '[data-testid="active-link"]',
    );
    expect(active?.getAttribute('data-status')).toBe('active');
    expect(active?.getAttribute('aria-current')).toBe('page');
    expect(active?.getAttribute('class')).toBe('nav is-active');

    const inactive = rendered.container.querySelector(
      '[data-testid="inactive-link"]',
    );
    expect(inactive?.getAttribute('data-status')).toBeNull();
    expect(inactive?.getAttribute('aria-current')).toBeNull();
  });

  test('prefix-matches nested locations unless exact is requested', async () => {
    const router = createTanstackRouter('/en/products/shoe', 'en');
    rendered = await renderWithRuntime(
      <ModernI18nProvider value={providerValue('en')}>
        <Link to="/products" data-testid="prefix">
          Products
        </Link>
        <Link
          to="/products"
          activeOptions={{ exact: true }}
          data-testid="exact"
        >
          Products
        </Link>
        <Link to="/" data-testid="root">
          Home
        </Link>
      </ModernI18nProvider>,
      createTanstackRuntimeContext(router),
    );

    expect(
      rendered.container
        .querySelector('[data-testid="prefix"]')
        ?.getAttribute('data-status'),
    ).toBe('active');
    expect(
      rendered.container
        .querySelector('[data-testid="exact"]')
        ?.getAttribute('data-status'),
    ).toBeNull();
    expect(
      rendered.container
        .querySelector('[data-testid="root"]')
        ?.getAttribute('data-status'),
    ).toBeNull();
  });

  test('useLocalizedLocation exposes per-language alternates', async () => {
    const router = createTanstackRouter('/cs/podminky-pouzivani?q=1#top', 'cs');
    let snapshot: ReturnType<typeof useLocalizedLocation> | undefined;

    const Probe = () => {
      snapshot = useLocalizedLocation();
      return null;
    };

    rendered = await renderWithRuntime(
      <ModernI18nProvider value={providerValue('cs')}>
        <Probe />
      </ModernI18nProvider>,
      createTanstackRuntimeContext(router),
    );

    expect(snapshot?.language).toBe('cs');
    expect(snapshot?.canonical).toBe('/terms-of-service');
    expect(snapshot?.alternates).toEqual({
      en: '/en/terms-of-service?q=1#top',
      cs: '/cs/podminky-pouzivani?q=1#top',
    });
  });
});
