import {
  applyRouterRuntimeState,
  InternalRuntimeContext,
  RuntimeContext,
} from '@modern-js/runtime/context';
import type React from 'react';
import type { ComponentType, PropsWithChildren } from 'react';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { i18nPlugin } from '../src/runtime';
import { ModernI18nProvider, useModernI18n } from '../src/runtime/context';
import { I18nLink } from '../src/runtime/I18nLink';
import type { I18nInstance } from '../src/runtime/i18n';
import { getReactI18nextIntegration } from '../src/runtime/i18n/react-i18next';
import { createI18nRootWrapper } from '../src/runtime/providerComposition';

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

const capturedTanstackLinkProps: any[] = [];

const TanstackLink = ({ to, children, ...props }: any) => {
  capturedTanstackLinkProps.push({ to, ...props });
  const { prefetch: _prefetch, preload: _preload, ...anchorProps } = props;

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
  const context = {
    isBrowser: true,
    requestContext,
    context: requestContext,
    router: {
      ...(framework === 'tanstack'
        ? { Link: TanstackLink, useRouter: () => router }
        : { useLocation: () => undefined, useHref: () => undefined }),
    },
  } as any;

  applyRouterRuntimeState(context, {
    framework,
    instance: router,
  });

  return context;
}

function createTanstackRuntimeContext(router: unknown) {
  return createRuntimeContext(router, 'tanstack');
}

function createReactRouterRuntimeContext(router: unknown) {
  return createRuntimeContext(router, 'react-router');
}

function collectI18nWrapRoot() {
  let wrapRoot: ((App: ComponentType<any>) => ComponentType<any>) | undefined;

  i18nPlugin({
    reactI18next: false,
    localeDetection: {
      fallbackLanguage: 'en',
    },
  }).setup?.({
    getRuntimeConfig: () => ({}),
    onBeforeRender: () => undefined,
    wrapRoot: (callback: (App: ComponentType<any>) => ComponentType<any>) => {
      wrapRoot = callback;
    },
  } as any);

  if (!wrapRoot) {
    throw new Error('Expected i18n runtime plugin to register wrapRoot');
  }

  return wrapRoot;
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

async function renderI18nRoot(node: React.ReactNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <RuntimeContext.Provider
        value={{
          isBrowser: true,
          requestContext,
          context: requestContext,
        }}
      >
        {node}
      </RuntimeContext.Provider>,
    );
  });

  return {
    container,
    root,
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

describe('i18n runtime wrapRoot', () => {
  let rendered: { container: HTMLElement; root: Root } | undefined;

  afterEach(() => {
    cleanup(rendered);
    rendered = undefined;
  });

  test('renders children when no root App exists yet', async () => {
    const wrapRoot = collectI18nWrapRoot();
    const I18nRoot = wrapRoot(undefined as unknown as ComponentType<any>);

    rendered = await renderI18nRoot(
      <I18nRoot>
        <main>router content</main>
      </I18nRoot>,
    );

    expect(rendered.container.textContent).toContain('router content');
  });

  test('preserves App props and children', async () => {
    const wrapRoot = collectI18nWrapRoot();
    const App = ({ children, label }: PropsWithChildren<{ label: string }>) => (
      <main data-label={label}>{children}</main>
    );
    const I18nRoot = wrapRoot(App);

    rendered = await renderI18nRoot(
      <I18nRoot label="root">
        <span>router content</span>
      </I18nRoot>,
    );

    expect(
      rendered.container.querySelector('main')?.getAttribute('data-label'),
    ).toBe('root');
    expect(rendered.container.textContent).toContain('router content');
  });

  test('keeps the optional i18next provider inside Modern i18n context', async () => {
    const i18nInstance = createI18nInstance('cs');
    const observedLanguages: string[] = [];
    const I18nextProvider = ({
      children,
      i18n,
    }: PropsWithChildren<{ i18n: I18nInstance }>) => {
      const { language } = useModernI18n();
      observedLanguages.push(`${language}:${i18n.language}`);

      return <section data-testid="i18next-provider">{children}</section>;
    };
    const App = () => <main>router content</main>;
    const I18nRoot = createI18nRootWrapper({
      htmlLangAttr: false,
      localePathRedirect: false,
      languages: ['en', 'cs'],
      fallbackLanguage: 'en',
      getLatestI18nInstance: () => i18nInstance,
      getI18nextProvider: () => I18nextProvider,
    })(App);

    rendered = await renderI18nRoot(<I18nRoot />);

    expect(observedLanguages).toEqual(['cs:cs']);
    expect(rendered.container.textContent).toContain('router content');
  });
});

describe('i18n react-i18next integration', () => {
  test('loads the bundled react-i18next integration', async () => {
    const integration = await getReactI18nextIntegration();

    expect(integration.I18nextProvider).toEqual(expect.any(Function));
    expect(integration.initReactI18next).toBeDefined();
  });
});

describe('i18n router adapter', () => {
  let rendered: { container: HTMLElement; root: Root } | undefined;

  afterEach(() => {
    cleanup(rendered);
    rendered = undefined;
    capturedTanstackLinkProps.length = 0;
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

  test('forwards warmup props through I18nLink with a localized string target', async () => {
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
        <I18nLink
          to="/terms-of-service"
          data-testid="terms-link"
          prefetch="viewport"
          preload="intent"
        >
          Terms
        </I18nLink>
      </ModernI18nProvider>,
      createTanstackRuntimeContext(router),
    );

    const linkProps = capturedTanstackLinkProps.at(-1);
    // TanStack has no `prefetch` prop: the explicit native `preload` wins and
    // `prefetch` must not be forwarded.
    expect(linkProps).toMatchObject({
      to: '/cs/podminky-pouzivani',
      preload: 'intent',
    });
    expect(linkProps.prefetch).toBeUndefined();
  });

  test('does not leak warmup props to fallback anchors', async () => {
    rendered = await renderI18nRoot(
      <ModernI18nProvider
        value={{
          language: 'cs',
          i18nInstance: createI18nInstance('cs'),
          languages: ['en', 'cs'],
          localePathRedirect: true,
          localisedUrls,
        }}
      >
        <I18nLink
          to="/terms-of-service"
          data-testid="terms-link"
          prefetch="none"
          preload={false}
        >
          Terms
        </I18nLink>
      </ModernI18nProvider>,
    );

    const link = rendered.container.querySelector<HTMLAnchorElement>(
      '[data-testid="terms-link"]',
    );
    expect(link?.getAttribute('href')).toBe('/cs/podminky-pouzivani');
    expect(link?.hasAttribute('prefetch')).toBe(false);
    expect(link?.hasAttribute('preload')).toBe(false);
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

  test('updates provider language when target locale is already in URL', async () => {
    window.history.replaceState(null, '', '/cs/podminky-pouzivani');

    const router = createTanstackRouter('/cs/podminky-pouzivani', 'cs');
    const i18nInstance = createI18nInstance('en');
    const updateLanguage = rstest.fn();
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
          i18nInstance,
          languages: ['en', 'cs'],
          localePathRedirect: true,
          localisedUrls,
          updateLanguage,
        }}
      >
        <Harness />
      </ModernI18nProvider>,
      createTanstackRuntimeContext(router),
    );

    const button = rendered.container.querySelector('button');
    updateLanguage.mockClear();

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

    expect(updateLanguage).toHaveBeenCalledWith('cs');
    expect(router.navigate).not.toHaveBeenCalled();
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

  test('exposes a language-scoped t function for rendered copy', async () => {
    const i18nInstance = createI18nInstance('en');
    i18nInstance.t = (key: string) => `${i18nInstance.language}:${key}`;
    const renderTranslations: Array<(key: string) => string> = [];
    let setProviderLanguage: ((language: string) => void) | undefined;

    const StatefulI18nProvider = ({ children }: PropsWithChildren) => {
      const [language, setLanguage] = useState('en');
      setProviderLanguage = setLanguage;

      return (
        <ModernI18nProvider
          value={{
            language,
            i18nInstance,
            languages: ['en', 'cs'],
            localePathRedirect: true,
            localisedUrls,
            updateLanguage: setLanguage,
          }}
        >
          {children}
        </ModernI18nProvider>
      );
    };

    const Harness = () => {
      const { t } = useModernI18n();
      renderTranslations.push(t);
      return <span data-testid="translation">{t('key')}</span>;
    };

    rendered = await renderWithRuntime(
      <StatefulI18nProvider>
        <Harness />
      </StatefulI18nProvider>,
      createReactRouterRuntimeContext({ navigate: rstest.fn() }),
    );

    expect(
      rendered.container.querySelector('[data-testid="translation"]')
        ?.textContent,
    ).toBe('en:key');
    const initialT = renderTranslations.at(-1);

    await act(async () => {
      i18nInstance.language = 'cs';
      setProviderLanguage?.('cs');
    });

    expect(
      rendered.container.querySelector('[data-testid="translation"]')
        ?.textContent,
    ).toBe('cs:key');
    expect(renderTranslations.at(-1)).not.toBe(initialT);
  });
});
