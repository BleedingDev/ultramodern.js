import {
  applyRouterRuntimeState,
  InternalRuntimeContext,
  RuntimeContext,
} from '@modern-js/runtime/context';
import {
  createMemoryRouter,
  Link as ReactRouterLink,
  RouterProvider,
} from '@modern-js/runtime/router';
import i18next from 'i18next';
import type React from 'react';
import type { ComponentType, PropsWithChildren } from 'react';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import { i18nPlugin } from '../src/runtime';
import { ModernI18nProvider, useModernI18n } from '../src/runtime/context';
import { I18nLink } from '../src/runtime/I18nLink';
import type { I18nInstance } from '../src/runtime/i18n';
import { getReactI18nextIntegration } from '../src/runtime/i18n/react-i18next';
import { createI18nRootWrapper } from '../src/runtime/providerComposition';
import { useI18nRouterAdapter } from '../src/runtime/routerAdapter';

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
    t: (key: string | string[]) => (Array.isArray(key) ? key[0] : key),
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

async function collectI18nRuntime(
  i18nInstance: I18nInstance,
  reactI18next = false,
) {
  let onBeforeRender:
    | ((
        context: ReturnType<typeof createTanstackRuntimeContext>,
      ) => Promise<void>)
    | undefined;
  let wrapRoot: ((App: ComponentType<any>) => ComponentType<any>) | undefined;

  i18nPlugin({
    i18nInstance,
    reactI18next,
    localeDetection: {
      fallbackLanguage: 'en',
      i18nextDetector: false,
      languages: ['en', 'cs'],
      localePathRedirect: true,
    },
  }).setup?.({
    getRuntimeConfig: () => ({}),
    onBeforeRender: (
      callback: (
        context: ReturnType<typeof createTanstackRuntimeContext>,
      ) => Promise<void>,
    ) => {
      onBeforeRender = callback;
    },
    wrapRoot: (callback: (App: ComponentType<any>) => ComponentType<any>) => {
      wrapRoot = callback;
    },
  } as any);

  if (!onBeforeRender || !wrapRoot) {
    throw new Error('Expected i18n runtime plugin lifecycle registrations');
  }

  return { onBeforeRender, wrapRoot };
}

async function createEventEmittingDeferredI18nInstance() {
  const instance = i18next.createInstance();
  await instance.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en: { translation: { languageSwitcher: 'Language' } },
      cs: { translation: { languageSwitcher: 'Jazyk' } },
    },
  });
  const originalHasLoadedNamespace = instance.hasLoadedNamespace;
  instance.hasLoadedNamespace = function hasLoadedNamespace(
    namespace,
    options,
  ) {
    if (this !== instance) {
      throw new Error('i18next hasLoadedNamespace receiver was not preserved');
    }
    return originalHasLoadedNamespace.call(this, namespace, options);
  };

  const pending: Array<{
    language: string;
    promise: Promise<unknown>;
    resolve: () => void;
  }> = [];
  const translator = (instance as unknown as { translator: I18nInstance })
    .translator;

  instance.changeLanguage = rstest.fn((language = 'en') => {
    let resolveChange!: (value: unknown) => void;
    const promise = new Promise<unknown>(resolve => {
      resolveChange = resolve;
    });
    pending.push({
      language,
      promise,
      resolve: () => {
        instance.language = language;
        translator.changeLanguage?.(language);
        instance.emit('languageChanged', language);
        resolveChange(instance.t.bind(instance));
      },
    });
    return promise;
  });

  return { instance, pending };
}

function createMutableTanstackRouter(pathname = '/en') {
  let location = {
    pathname,
    searchStr: '',
    hash: '',
  };
  let matches = [{ params: { lang: pathname.slice(1) } }];
  const listeners = new Set<() => void>();

  return {
    navigate: rstest.fn(async () => undefined),
    stores: {
      location: {
        get: () => location,
        subscribe: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      matches: {
        get: () => matches,
      },
    },
    publishPathname(nextPathname: string) {
      location = {
        pathname: nextPathname,
        searchStr: '',
        hash: '',
      };
      matches = [{ params: { lang: nextPathname.slice(1) } }];
      for (const listener of listeners) {
        listener();
      }
    },
    publishStateUpdate() {
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

function createMutableReactRouter(
  pathname = '/en',
  params: Record<string, string> = { lang: pathname.slice(1) },
) {
  const listeners = new Set<() => void>();
  const router = {
    state: {
      location: {
        pathname,
        search: '',
        hash: '',
      },
      matches: [{ params }],
      fetchers: new Map<string, unknown>(),
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publishFetcherUpdate() {
      router.state = {
        ...router.state,
        fetchers: new Map([['fetcher', { state: 'idle' }]]),
      };
      for (const listener of listeners) {
        listener();
      }
    },
    publishPathname(nextPathname: string) {
      router.state = {
        ...router.state,
        location: {
          ...router.state.location,
          pathname: nextPathname,
        },
      };
      for (const listener of listeners) {
        listener();
      }
    },
    publishParams(nextParams: Record<string, string>) {
      router.state = {
        ...router.state,
        matches: [{ params: nextParams }],
      };
      for (const listener of listeners) {
        listener();
      }
    },
  };

  return router;
}

function createDeferredI18nInstance() {
  const resources = {
    en: { languageSwitcher: 'Language' },
    cs: { languageSwitcher: 'Jazyk' },
  };
  const pending: Array<{
    language: keyof typeof resources;
    promise: Promise<void>;
    resolve: () => void;
    reject: (error: Error) => void;
  }> = [];
  const instance = createI18nInstance('en');
  delete instance.setLang;
  instance.t = (key: string) =>
    resources[instance.language as keyof typeof resources][
      key as keyof (typeof resources)['en']
    ];
  instance.changeLanguage = rstest.fn((language = 'en') => {
    let resolveChange!: () => void;
    let rejectChange!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolveChange = resolve;
      rejectChange = reject;
    });
    pending.push({
      language: language as keyof typeof resources,
      promise,
      resolve: () => {
        instance.language = language;
        resolveChange();
      },
      reject: rejectChange,
    });
    return promise;
  });

  return { instance, pending };
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

async function renderWithRuntimeContexts(
  node: React.ReactNode,
  runtimeContext: ReturnType<typeof createTanstackRuntimeContext>,
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <InternalRuntimeContext.Provider value={runtimeContext}>
        <RuntimeContext.Provider value={runtimeContext}>
          {node}
        </RuntimeContext.Provider>
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
    rstest.restoreAllMocks();
    window.history.replaceState(null, '', '/');
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

  test('keeps the i18next provider instance stable across unrelated parent renders', async () => {
    const i18nInstance = createI18nInstance('cs');
    const providerInstances: I18nInstance[] = [];
    const I18nextProvider = ({
      children,
      i18n,
    }: PropsWithChildren<{ i18n: I18nInstance }>) => {
      providerInstances.push(i18n);
      return <>{children}</>;
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
    const Parent = () => {
      const [renderVersion, setRenderVersion] = useState(0);
      return (
        <>
          <button
            type="button"
            onClick={() => setRenderVersion(version => version + 1)}
          >
            Render {renderVersion}
          </button>
          <I18nRoot renderVersion={renderVersion} />
        </>
      );
    };

    rendered = await renderI18nRoot(<Parent />);
    const initialProviderInstance = providerInstances.at(-1);

    await act(async () => {
      rendered?.container
        .querySelector('button')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(providerInstances.length).toBeGreaterThan(1);
    expect(providerInstances.at(-1)).toBe(initialProviderInstance);
  });

  test('commits route language and translated copy after the instance changes', async () => {
    window.history.replaceState(null, '', '/en');
    const router = createMutableTanstackRouter();
    const runtimeContext = createTanstackRuntimeContext(router);
    const { instance, pending } = createDeferredI18nInstance();
    const { onBeforeRender, wrapRoot } = await collectI18nRuntime(instance);
    await onBeforeRender(runtimeContext);

    const Translation = ({ id }: { id: string }) => {
      const { language, t } = useModernI18n();
      return (
        <span data-testid={id}>
          {language}:{t('languageSwitcher')}
        </span>
      );
    };
    const App = () => (
      <main>
        <Translation id="first" />
        <Translation id="second" />
      </main>
    );
    const I18nRoot = wrapRoot(App);

    rendered = await renderWithRuntime(<I18nRoot />, runtimeContext);

    expect(rendered.container.textContent).toBe('en:Languageen:Language');

    await act(async () => {
      router.publishPathname('/cs');
    });

    expect(instance.changeLanguage).toHaveBeenCalledTimes(1);
    expect(instance.changeLanguage).toHaveBeenCalledWith('cs');
    expect(rendered.container.textContent).toBe('en:Languageen:Language');

    await act(async () => {
      pending[0].resolve();
      await pending[0].promise;
    });

    expect(rendered.container.textContent).toBe('cs:Jazykcs:Jazyk');
  });

  test('uses the wrapper language operation without changing twice', async () => {
    window.history.replaceState(null, '', '/en');
    const router = createMutableTanstackRouter();
    const runtimeContext = createTanstackRuntimeContext(router);
    const instance = createI18nInstance();
    const { onBeforeRender, wrapRoot } = await collectI18nRuntime(instance);
    await onBeforeRender(runtimeContext);

    const App = () => {
      const { language } = useModernI18n();
      return <main>{language}</main>;
    };
    const I18nRoot = wrapRoot(App);
    rendered = await renderWithRuntime(<I18nRoot />, runtimeContext);

    await act(async () => {
      router.publishPathname('/cs');
      await Promise.resolve();
    });

    expect(instance.setLang).toHaveBeenCalledTimes(1);
    expect(instance.setLang).toHaveBeenCalledWith('cs');
    expect(instance.changeLanguage).not.toHaveBeenCalled();
    expect(rendered.container.textContent).toBe('cs');
  });

  test('keeps the latest route when language changes resolve out of order', async () => {
    window.history.replaceState(null, '', '/en');
    const router = createMutableTanstackRouter();
    const runtimeContext = createTanstackRuntimeContext(router);
    const { instance, pending } = createDeferredI18nInstance();
    const { onBeforeRender, wrapRoot } = await collectI18nRuntime(instance);
    await onBeforeRender(runtimeContext);

    const App = () => {
      const { language, t } = useModernI18n();
      return (
        <main>
          {language}:{t('languageSwitcher')}
        </main>
      );
    };
    const I18nRoot = wrapRoot(App);
    rendered = await renderWithRuntime(<I18nRoot />, runtimeContext);

    await act(async () => {
      router.publishPathname('/cs');
    });
    expect(pending).toHaveLength(1);

    await act(async () => {
      router.publishPathname('/en');
    });
    expect(rendered.container.textContent).toBe('en:Language');

    await act(async () => {
      pending[0].resolve();
      await pending[0].promise;
    });

    expect(rendered.container.textContent).toBe('en:Language');
    expect(pending).toHaveLength(2);
    expect(pending[1].language).toBe('en');

    await act(async () => {
      pending[1].resolve();
      await pending[1].promise;
    });

    expect(rendered.container.textContent).toBe('en:Language');
    expect(instance.language).toBe('en');
  });

  test('does not block a replacement instance behind abandoned language work', async () => {
    window.history.replaceState(null, '', '/en');
    const router = createMutableTanstackRouter();
    const runtimeContext = createTanstackRuntimeContext(router);
    const oldI18n = createDeferredI18nInstance();
    runtimeContext.i18nInstance = oldI18n.instance;
    const { onBeforeRender, wrapRoot } = await collectI18nRuntime(
      oldI18n.instance,
    );
    await onBeforeRender(runtimeContext);

    const App = () => {
      const { language } = useModernI18n();
      return <main>{language}</main>;
    };
    const I18nRoot = wrapRoot(App);
    rendered = await renderWithRuntimeContexts(<I18nRoot />, runtimeContext);

    await act(async () => {
      router.publishPathname('/cs');
    });
    expect(oldI18n.pending).toHaveLength(1);

    const replacementI18n = createDeferredI18nInstance();
    const replacementContext = createTanstackRuntimeContext(router);
    replacementContext.i18nInstance = replacementI18n.instance;
    await act(async () => {
      rendered?.root.render(
        <InternalRuntimeContext.Provider value={replacementContext}>
          <RuntimeContext.Provider value={replacementContext}>
            <I18nRoot />
          </RuntimeContext.Provider>
        </InternalRuntimeContext.Provider>,
      );
    });

    expect(replacementI18n.pending).toHaveLength(1);
    expect(replacementI18n.pending[0].language).toBe('cs');
  });

  test('does not expose an obsolete route language through react-i18next', async () => {
    window.history.replaceState(null, '', '/en');
    const router = createMutableTanstackRouter();
    const runtimeContext = createTanstackRuntimeContext(router);
    const { instance, pending } =
      await createEventEmittingDeferredI18nInstance();
    const { onBeforeRender, wrapRoot } = await collectI18nRuntime(
      instance,
      true,
    );
    await onBeforeRender(runtimeContext);

    const App = () => {
      const { t } = useTranslation();
      return <main>{t('languageSwitcher')}</main>;
    };
    const I18nRoot = wrapRoot(App);
    rendered = await renderWithRuntime(<I18nRoot />, runtimeContext);

    await act(async () => {
      router.publishPathname('/cs');
    });
    expect(pending).toHaveLength(1);

    await act(async () => {
      router.publishPathname('/en');
    });

    await act(async () => {
      pending[0].resolve();
      await pending[0].promise;
    });

    expect(rendered.container.textContent).toBe('Language');
  });

  test('keeps committed copy after a failed change and recovers later', async () => {
    window.history.replaceState(null, '', '/en');
    const consoleError = rstest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const router = createMutableTanstackRouter();
    const runtimeContext = createTanstackRuntimeContext(router);
    const { instance, pending } = createDeferredI18nInstance();
    const { onBeforeRender, wrapRoot } = await collectI18nRuntime(instance);
    await onBeforeRender(runtimeContext);

    const RetryConsumer = () => {
      useModernI18n();
      return null;
    };
    const App = () => {
      const [showRetryConsumer, setShowRetryConsumer] = useState(false);
      const { language, t } = useModernI18n();
      return (
        <main>
          {language}:{t('languageSwitcher')}
          <button type="button" onClick={() => setShowRetryConsumer(true)}>
            Retry
          </button>
          {showRetryConsumer && <RetryConsumer />}
        </main>
      );
    };
    const I18nRoot = wrapRoot(App);
    rendered = await renderWithRuntime(<I18nRoot />, runtimeContext);

    await act(async () => {
      router.publishPathname('/cs');
    });

    const languageError = new Error('failed to load Czech resources');
    await act(async () => {
      pending[0].reject(languageError);
      await pending[0].promise.catch(() => undefined);
    });

    expect(rendered.container.textContent).toContain('en:Language');
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to synchronize i18n language "cs".',
      languageError,
    );

    await act(async () => {
      rendered?.container
        .querySelector('button')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(pending).toHaveLength(2);

    await act(async () => {
      pending[1].resolve();
      await pending[1].promise;
    });

    expect(rendered.container.textContent).toContain('cs:Jazyk');
    expect(instance.language).toBe('cs');
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

  test('ignores router state updates that do not change location or params', async () => {
    const router = createMutableTanstackRouter('/en');
    let renders = 0;
    const LocationProbe = () => {
      renders += 1;
      const { location } = useI18nRouterAdapter();
      return <output>{location?.pathname}</output>;
    };

    rendered = await renderWithRuntime(
      <LocationProbe />,
      createTanstackRuntimeContext(router),
    );
    const initialRenders = renders;

    await act(async () => {
      router.publishStateUpdate();
    });
    expect(renders).toBe(initialRenders);
    expect(rendered.container.textContent).toBe('/en');

    await act(async () => {
      router.publishPathname('/cs');
    });
    expect(renders).toBe(initialRenders + 1);
    expect(rendered.container.textContent).toBe('/cs');
  });

  test('ignores React Router fetcher updates while observing location changes', async () => {
    const router = createMutableReactRouter('/en');
    let renders = 0;
    const LocationProbe = () => {
      renders += 1;
      const { location } = useI18nRouterAdapter();
      return <output>{location?.pathname}</output>;
    };

    rendered = await renderWithRuntime(
      <LocationProbe />,
      createReactRouterRuntimeContext(router),
    );
    const initialRenders = renders;

    await act(async () => {
      router.publishFetcherUpdate();
    });
    expect(renders).toBe(initialRenders);
    expect(rendered.container.textContent).toBe('/en');

    await act(async () => {
      router.publishPathname('/cs');
    });
    expect(renders).toBe(initialRenders + 1);
    expect(rendered.container.textContent).toBe('/cs');
  });

  test('observes distinct route params without serialized snapshot collisions', async () => {
    const router = createMutableReactRouter('/products', {
      a: '1&b=2',
    });
    const ParamsProbe = () => {
      const { params } = useI18nRouterAdapter();
      return <output>{JSON.stringify(params)}</output>;
    };

    rendered = await renderWithRuntime(
      <ParamsProbe />,
      createReactRouterRuntimeContext(router),
    );
    expect(rendered.container.textContent).toBe('{"a":"1&b=2"}');

    await act(async () => {
      router.publishParams({ a: '1', b: '2' });
    });
    expect(rendered.container.textContent).toBe('{"a":"1","b":"2"}');
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

  test('tracks React Router link and history navigation without Modern i18n consumers', async () => {
    window.history.replaceState(null, '', '/en');
    const i18nInstance = i18next.createInstance();
    await i18nInstance.init({
      lng: 'en',
      fallbackLng: 'en',
      resources: {
        en: { translation: { languageSwitcher: 'Language' } },
        cs: { translation: { languageSwitcher: 'Jazyk' } },
      },
    });

    const RouteContent = () => {
      const { t } = useTranslation();
      return (
        <main>
          <span data-testid="translation">{t('languageSwitcher')}</span>
          <ReactRouterLink to="/cs">Czech</ReactRouterLink>
        </main>
      );
    };
    const router = createMemoryRouter(
      [{ path: '/:lang', element: <RouteContent /> }],
      { initialEntries: ['/en'] },
    );
    const originalSubscribe = router.subscribe;
    router.subscribe = function subscribe(listener) {
      if (this !== router) {
        throw new Error('React Router subscribe receiver was not preserved');
      }
      return originalSubscribe.call(this, listener);
    };
    const runtimeContext = createReactRouterRuntimeContext(router);
    const { onBeforeRender, wrapRoot } = await collectI18nRuntime(
      i18nInstance,
      true,
    );
    await onBeforeRender(runtimeContext);
    const I18nRoot = wrapRoot(() => <RouterProvider router={router} />);
    rendered = await renderWithRuntime(<I18nRoot />, runtimeContext);

    await act(async () => {
      rendered?.container
        .querySelector('a')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(
      rendered.container.querySelector('[data-testid="translation"]')
        ?.textContent,
    ).toBe('Jazyk');

    await act(async () => {
      await router.navigate(-1);
    });
    expect(
      rendered.container.querySelector('[data-testid="translation"]')
        ?.textContent,
    ).toBe('Language');
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
