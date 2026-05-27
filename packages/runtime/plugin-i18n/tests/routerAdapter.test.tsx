import { InternalRuntimeContext } from '@modern-js/runtime/context';
import type React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ModernI18nProvider, useModernI18n } from '../src/runtime/context';
import { I18nLink } from '../src/runtime/I18nLink';
import type { I18nInstance } from '../src/runtime/i18n';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const localisedUrls = {
  '/terms-of-service': {
    en: '/terms-of-service',
    cs: '/podminky-pouzivani',
  },
};

const requestContext = {
  request: {},
  response: {},
};

const TanstackLink = ({ to, children, ...props }: any) => (
  <a href={to} data-router-link="tanstack" {...props}>
    {children}
  </a>
);

function createI18nInstance(language = 'en'): I18nInstance {
  return {
    language,
    isInitialized: true,
    init: () => Promise.resolve(undefined),
    use: () => {},
    createInstance: () => createI18nInstance(language),
    setLang: rstest.fn(async () => undefined),
    changeLanguage: rstest.fn(async () => undefined),
    services: {},
    options: {},
  };
}

function createRuntimeContext(
  router: unknown,
  framework: 'tanstack' | 'react-router',
) {
  return {
    isBrowser: true,
    requestContext,
    context: requestContext,
    routerFramework: framework,
    routerInstance: router,
    routerRuntime: {
      framework,
      instance: router,
    },
    router: {
      ...(framework === 'tanstack'
        ? { Link: TanstackLink, useRouter: () => router }
        : { useLocation: () => undefined, useHref: () => undefined }),
    },
  } as any;
}

function createTanstackRuntimeContext(router: unknown) {
  return createRuntimeContext(router, 'tanstack');
}

function createReactRouterRuntimeContext(router: unknown) {
  return createRuntimeContext(router, 'react-router');
}

function createTanstackRouter(pathname = '/en/terms-of-service', lang = 'en') {
  const url = new URL(pathname, 'https://modernjs.test');

  return {
    navigate: rstest.fn(async () => undefined),
    state: {
      location: {
        pathname: url.pathname,
        searchStr: url.search,
        hash: url.hash,
      },
      matches: [
        {
          params: {
            lang,
          },
        },
      ],
    },
  };
}

async function renderWithRuntime(
  node: React.ReactNode,
  runtimeContext: ReturnType<typeof createTanstackRuntimeContext>,
) {
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

  return {
    container,
    root,
  };
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

describe('i18n router adapter', () => {
  let rendered: { container: HTMLElement; root: Root } | undefined;

  afterEach(() => {
    cleanup(rendered);
    rendered = undefined;
    window.history.replaceState(null, '', '/');
  });

  test('uses the TanStack router Link for I18nLink rendering', async () => {
    const router = createTanstackRouter('/cs/podminky-pouzivani', 'cs');
    rendered = await renderWithRuntime(
      <ModernI18nProvider
        value={{
          language: 'cs',
          i18nInstance: createI18nInstance('cs'),
          languages: ['en', 'cs'],
          localePathRedirect: true,
          localisedUrls,
        }}
      >
        <I18nLink to="/terms-of-service" data-testid="terms-link">
          Terms
        </I18nLink>
      </ModernI18nProvider>,
      createTanstackRuntimeContext(router),
    );

    const link = rendered.container.querySelector<HTMLAnchorElement>(
      '[data-testid="terms-link"]',
    );
    expect(link?.getAttribute('href')).toBe('/cs/podminky-pouzivani');
    expect(link?.getAttribute('data-router-link')).toBe('tanstack');
  });

  test('uses TanStack-shaped replacement when changeLanguage updates the URL', async () => {
    window.history.replaceState(
      null,
      '',
      '/en/terms-of-service?from=test#section',
    );

    const router = createTanstackRouter(
      '/en/terms-of-service?from=test#section',
    );
    let changeLanguagePromise: Promise<void> | undefined;

    const Harness = () => {
      const { changeLanguage } = useModernI18n();
      return (
        <button
          type="button"
          onClick={() => {
            changeLanguagePromise = changeLanguage('cs');
          }}
        >
          Change language
        </button>
      );
    };

    rendered = await renderWithRuntime(
      <ModernI18nProvider
        value={{
          language: 'en',
          i18nInstance: createI18nInstance('en'),
          languages: ['en', 'cs'],
          localePathRedirect: true,
          localisedUrls,
        }}
      >
        <Harness />
      </ModernI18nProvider>,
      createTanstackRuntimeContext(router),
    );

    const button = rendered.container.querySelector('button');

    await act(async () => {
      button?.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
      await changeLanguagePromise;
    });

    expect(router.navigate).toHaveBeenCalledWith({
      to: '/cs/podminky-pouzivani?from=test#section',
      replace: true,
    });
  });

  test('keeps React Router positional replacement when changeLanguage updates the URL', async () => {
    window.history.replaceState(null, '', '/en/terms-of-service');

    const router = {
      navigate: rstest.fn(async () => undefined),
    };
    let changeLanguagePromise: Promise<void> | undefined;

    const Harness = () => {
      const { changeLanguage } = useModernI18n();
      return (
        <button
          type="button"
          onClick={() => {
            changeLanguagePromise = changeLanguage('cs');
          }}
        >
          Change language
        </button>
      );
    };

    rendered = await renderWithRuntime(
      <ModernI18nProvider
        value={{
          language: 'en',
          i18nInstance: createI18nInstance('en'),
          languages: ['en', 'cs'],
          localePathRedirect: true,
          localisedUrls,
        }}
      >
        <Harness />
      </ModernI18nProvider>,
      createReactRouterRuntimeContext(router),
    );

    const button = rendered.container.querySelector('button');

    await act(async () => {
      button?.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
      await changeLanguagePromise;
    });

    expect(router.navigate).toHaveBeenCalledWith('/cs/podminky-pouzivani', {
      replace: true,
    });
  });
});
