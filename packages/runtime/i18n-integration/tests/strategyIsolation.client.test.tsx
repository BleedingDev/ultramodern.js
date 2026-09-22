import { ModernI18nProvider } from '@modern-js/plugin-i18n/runtime/consumer';
import type { I18nInstance } from '@modern-js/plugin-i18n/runtime/no-react-i18next';
import {
  Link,
  useLocalizedLocation,
} from '@modern-js/plugin-i18n/runtime/no-react-i18next';
import { InternalRuntimeContext } from '@modern-js/runtime/context';
import { applyRouterRuntimeState } from '@modern-js/runtime-extensions/router-state';
import type React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createTanstackNavigation } from '../../plugin-tanstack/src/runtime/navigation';
import { I18nRouterNavigationProvider } from '../src/navigation';
import { createI18nUrlStrategy } from '../src/urlStrategy';

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
    t: (key: string | string[]) => (Array.isArray(key) ? key[0] : key),
    createInstance: () => createI18nInstance(language),
    services: {},
    options: {},
  };
}

function createTanstackRouter(target = '/en/terms-of-service', lang = 'en') {
  const url = new URL(target, 'https://modernjs.test');

  return {
    navigate: rstest.fn(async () => undefined),
    subscribe: () => () => {},
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
  const context = {
    isBrowser: true,
    requestContext,
    context: requestContext,
    router: {
      Link: TanstackLink,
      useRouter: () => router,
    },
  } as any;
  applyRouterRuntimeState(context, {
    framework: 'tanstack',
    instance: router,
    navigation: {
      ...createTanstackNavigation(
        router as Parameters<typeof createTanstackNavigation>[0],
      ),
      Link: TanstackLink,
    },
  });
  return context;
}

function providerValue(language: string) {
  return {
    language,
    i18nInstance: createI18nInstance(language),
    languages,
    localePathRedirect: true,
    urlStrategy: createI18nUrlStrategy(localisedUrls),
  };
}

async function renderWithRuntime(node: React.ReactNode, runtimeContext: any) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <InternalRuntimeContext.Provider value={runtimeContext}>
        <I18nRouterNavigationProvider>{node}</I18nRouterNavigationProvider>
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

    // A hash-only target (no query) also passes natively for cross-page hashes.
    const hashRouter = createTanstackRouter('/cs/podminky-pouzivani', 'cs');
    rendered = await renderWithRuntime(
      <ModernI18nProvider value={providerValue('cs')}>
        <Link to="/#work-with-me" data-testid="cta">
          CTA
        </Link>
      </ModernI18nProvider>,
      createTanstackRuntimeContext(hashRouter),
    );
    const hashProps = capturedLinkProps.at(-1);
    expect(hashProps.to).toBe('/cs');
    expect(hashProps.hash).toBe('work-with-me');
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

  test('maps prefetch="none" to preload={false}; explicit preload wins', async () => {
    const router = createTanstackRouter('/en/products', 'en');
    rendered = await renderWithRuntime(
      <ModernI18nProvider value={providerValue('en')}>
        <Link to="/products" data-testid="pf" prefetch="intent">
          Products
        </Link>
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

    const intentProps = capturedLinkProps[capturedLinkProps.length - 3];
    expect(intentProps.preload).toBe('intent');
    expect(intentProps.prefetch).toBeUndefined();
    const intentLink = rendered.container.querySelector('[data-testid="pf"]');
    expect(intentLink?.hasAttribute('prefetch')).toBe(false);

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

describe('provider-owned URL strategies', () => {
  test('keeps concurrent roots and nested provider maps isolated', async () => {
    const first = createI18nUrlStrategy({
      '/products': { en: '/first', cs: '/prvni' },
    });
    const second = createI18nUrlStrategy({
      '/products': { en: '/second', cs: '/druhy' },
    });
    const firstTree = await renderWithRuntime(
      <ModernI18nProvider
        value={{ ...providerValue('cs'), urlStrategy: first }}
      >
        <Link to="/products" data-testid="outer">
          Outer
        </Link>
        <ModernI18nProvider
          value={{ ...providerValue('cs'), urlStrategy: second }}
        >
          <Link to="/products" data-testid="nested">
            Nested
          </Link>
        </ModernI18nProvider>
        <Link to="/products" data-testid="after">
          After
        </Link>
      </ModernI18nProvider>,
      { isBrowser: true, requestContext, context: requestContext },
    );
    const secondTree = await renderWithRuntime(
      <ModernI18nProvider
        value={{ ...providerValue('cs'), urlStrategy: second }}
      >
        <Link to="/products" data-testid="separate">
          Separate
        </Link>
      </ModernI18nProvider>,
      { isBrowser: true, requestContext, context: requestContext },
    );
    try {
      expect(
        firstTree.container
          .querySelector('[data-testid="outer"]')
          ?.getAttribute('href'),
      ).toBe('/cs/prvni');
      expect(
        firstTree.container
          .querySelector('[data-testid="nested"]')
          ?.getAttribute('href'),
      ).toBe('/cs/druhy');
      expect(
        firstTree.container
          .querySelector('[data-testid="after"]')
          ?.getAttribute('href'),
      ).toBe('/cs/prvni');
      expect(
        secondTree.container.querySelector('a')?.getAttribute('href'),
      ).toBe('/cs/druhy');
    } finally {
      cleanup(firstTree);
      cleanup(secondTree);
    }
  });
});
