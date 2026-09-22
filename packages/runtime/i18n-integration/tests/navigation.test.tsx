import {
  ModernI18nProvider,
  useModernI18n,
} from '@modern-js/plugin-i18n/runtime/consumer';
import type { I18nInstance } from '@modern-js/plugin-i18n/runtime/no-react-i18next';
import {
  InternalRuntimeContext,
  RuntimeContext,
} from '@modern-js/runtime/context';
import {
  createMemoryRouter,
  Link as ReactRouterLink,
  RouterProvider,
} from '@modern-js/runtime/router';
import { applyRouterRuntimeState } from '@modern-js/runtime-extensions/router-state';
import { createRouterStatePlugin } from '@modern-js/runtime-extensions/router-state-plugin';
import i18next from 'i18next';
import type React from 'react';
import type { ComponentType } from 'react';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import { createTanstackNavigation } from '../../plugin-tanstack/src/runtime/navigation';
import { I18nRouterNavigationProvider } from '../src/navigation';
import type { I18nPluginOptions } from '../src/options';
import { i18nPlugin } from '../src/runtime';
import { createI18nUrlStrategy } from '../src/urlStrategy';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const localisedUrls = {
  '/terms-of-service': {
    en: '/terms-of-service',
    cs: '/podminky-pouzivani',
  },
};

const requestContext = { request: {}, response: {} };

const TanstackLink = ({ to, children, ...props }: any) => {
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
        : {
            Link: ReactRouterLink,
            useLocation: () => undefined,
            useHref: () => undefined,
          }),
    },
  } as any;
  if (framework === 'tanstack') {
    applyRouterRuntimeState(context, {
      framework,
      instance: router,
      navigation: createTanstackNavigation(
        router as Parameters<typeof createTanstackNavigation>[0],
      ),
    });
  } else {
    createRouterStatePlugin({ registryHooks: {} }).setup({
      onBeforeRender() {},
      onAfterCreateRouter(callback) {
        callback({
          framework,
          phase: 'client-create',
          runtimeContext: context,
          router,
        });
      },
    });
  }
  return context;
}

const createTanstackRuntimeContext = (router: unknown) =>
  createRuntimeContext(router, 'tanstack');
const createReactRouterRuntimeContext = (router: unknown) =>
  createRuntimeContext(router, 'react-router');

async function collectI18nRuntime(
  i18nInstance: I18nInstance,
  reactI18next = false,
  localeDetectionOverrides: NonNullable<
    I18nPluginOptions['localeDetection']
  > = {},
) {
  let onBeforeRender: ((context: any) => Promise<void>) | undefined;
  let wrapRoot: ((App: ComponentType<any>) => ComponentType<any>) | undefined;

  i18nPlugin({
    i18nInstance,
    reactI18next,
    localeDetection: {
      fallbackLanguage: 'en',
      i18nextDetector: false,
      languages: ['en', 'cs'],
      localePathRedirect: true,
      ...localeDetectionOverrides,
    },
  }).setup?.({
    getRuntimeConfig: () => ({}),
    resolveComponent: () => undefined,
    onBeforeRender: (callback: (context: any) => Promise<void>) => {
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

function createMutableTanstackRouter(pathname = '/en') {
  let location = { pathname, searchStr: '', hash: '' };
  let matches = [{ params: { lang: pathname.slice(1) } }];
  const listeners = new Set<() => void>();

  return {
    navigate: rstest.fn(async () => undefined),
    get state() {
      return { location, matches };
    },
    subscribe(_event: string, listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stores: {
      location: {
        get: () => location,
        subscribe: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      matches: { get: () => matches },
    },
    publishPathname(nextPathname: string) {
      location = { pathname: nextPathname, searchStr: '', hash: '' };
      matches = [{ params: { lang: nextPathname.slice(1) } }];
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

const DEFERRED_COPY: Record<string, string> = { en: 'Language', cs: 'Jazyk' };

/** i18n instance whose changeLanguage stays pending until the test resolves it. */
function createDeferredI18nInstance() {
  const pending: Array<{
    language: string;
    promise: Promise<void>;
    resolve: () => void;
    reject: (error: Error) => void;
  }> = [];
  const instance = createI18nInstance('en');
  delete instance.setLang;
  instance.t = () => DEFERRED_COPY[instance.language];
  instance.changeLanguage = rstest.fn((language = 'en') => {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = () => {
        instance.language = language;
        res();
      };
      reject = rej;
    });
    pending.push({ language, promise, resolve, reject });
    return promise;
  });

  return { instance, pending };
}

async function renderWithRuntime(node: React.ReactNode, runtimeContext: any) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <InternalRuntimeContext.Provider value={runtimeContext}>
        <RuntimeContext.Provider value={runtimeContext}>
          <I18nRouterNavigationProvider>{node}</I18nRouterNavigationProvider>
        </RuntimeContext.Provider>
      </InternalRuntimeContext.Provider>,
    );
  });
  return { container, root };
}

/** Renders a button wired to changeLanguage('cs') and clicks it. */
async function changeLanguageThroughConsumer(runtimeContext: any) {
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

  const rendered = await renderWithRuntime(
    <ModernI18nProvider
      value={{
        language: 'en',
        i18nInstance: createI18nInstance('en'),
        languages: ['en', 'cs'],
        localePathRedirect: true,
        urlStrategy: createI18nUrlStrategy(localisedUrls),
      }}
    >
      <Harness />
    </ModernI18nProvider>,
    runtimeContext,
  );

  await act(async () => {
    rendered.container.querySelector('button')?.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: 0,
      }),
    );
    await changeLanguagePromise;
  });

  return rendered;
}

const LanguageCopy = () => {
  const { language, t } = useModernI18n();
  return (
    <main>
      {language}:{t('languageSwitcher')}
    </main>
  );
};

/** Boots the runtime plugin on /en with a deferred i18n instance and renders App. */
async function mountLanguageLifecycle(App: ComponentType<any> = LanguageCopy) {
  window.history.replaceState(null, '', '/en');
  const router = createMutableTanstackRouter();
  const runtimeContext = createTanstackRuntimeContext(router);
  const { instance, pending } = createDeferredI18nInstance();
  const { onBeforeRender, wrapRoot } = await collectI18nRuntime(instance);
  await onBeforeRender(runtimeContext);
  const I18nRoot = wrapRoot(App);
  const rendered = await renderWithRuntime(<I18nRoot />, runtimeContext);
  return { router, instance, pending, rendered };
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

describe('integrated route language lifecycle', () => {
  let rendered: { container: HTMLElement; root: Root } | undefined;
  afterEach(() => {
    cleanup(rendered);
    rendered = undefined;
    rstest.useRealTimers();
    rstest.restoreAllMocks();
    window.history.replaceState(null, '', '/');
  });

  test('commits route language and translated copy after the instance changes', async () => {
    const lifecycle = await mountLanguageLifecycle();
    const { router, instance, pending } = lifecycle;
    rendered = lifecycle.rendered;
    expect(rendered.container.textContent).toBe('en:Language');

    await act(async () => {
      router.publishPathname('/cs');
    });
    expect(instance.changeLanguage).toHaveBeenCalledWith('cs');
    // Copy must not flip before the new resources have loaded.
    expect(rendered.container.textContent).toBe('en:Language');

    await act(async () => {
      pending[0].resolve();
      await pending[0].promise;
    });
    expect(rendered.container.textContent).toBe('cs:Jazyk');
  });

  test('keeps the latest route when language changes resolve out of order', async () => {
    const lifecycle = await mountLanguageLifecycle();
    const { router, instance, pending } = lifecycle;
    rendered = lifecycle.rendered;

    await act(async () => {
      router.publishPathname('/cs');
    });
    await act(async () => {
      router.publishPathname('/en');
    });
    await act(async () => {
      pending[0].resolve();
      await pending[0].promise;
    });
    expect(rendered.container.textContent).toBe('en:Language');

    await act(async () => {
      pending[1].resolve();
      await pending[1].promise;
    });
    expect(rendered.container.textContent).toBe('en:Language');
    expect(instance.language).toBe('en');
  });

  test('keeps committed copy after a failed change and retries automatically', async () => {
    rstest.useFakeTimers();
    rstest.spyOn(console, 'error').mockImplementation(() => undefined);

    const RetryConsumer = () => {
      useModernI18n();
      return null;
    };
    const lifecycle = await mountLanguageLifecycle(() => {
      const [showRetryConsumer, setShowRetryConsumer] = useState(false);
      return (
        <main>
          <LanguageCopy />
          <button type="button" onClick={() => setShowRetryConsumer(true)}>
            Retry
          </button>
          {showRetryConsumer && <RetryConsumer />}
        </main>
      );
    });
    const { router, instance, pending } = lifecycle;
    rendered = lifecycle.rendered;

    await act(async () => {
      router.publishPathname('/cs');
    });
    await act(async () => {
      pending[0].reject(new Error('failed to load Czech resources'));
      await pending[0].promise.catch(() => undefined);
    });
    expect(rendered.container.textContent).toContain('en:Language');

    await act(async () => {
      await rstest.advanceTimersByTimeAsync(50);
    });
    await act(async () => {
      pending[1].resolve();
      await pending[1].promise;
    });
    expect(rendered.container.textContent).toContain('cs:Jazyk');
    expect(instance.language).toBe('cs');
  });
});

describe('i18n router adapter', () => {
  let rendered: { container: HTMLElement; root: Root } | undefined;

  afterEach(() => {
    cleanup(rendered);
    rendered = undefined;
    window.history.replaceState(null, '', '/');
  });

  test('uses TanStack-shaped replacement when changeLanguage updates the URL', async () => {
    window.history.replaceState(
      null,
      '',
      '/en/terms-of-service?from=test#section',
    );
    const router = createMutableTanstackRouter('/en/terms-of-service');
    router.stores.location.get().searchStr = '?from=test';
    router.stores.location.get().hash = '#section';
    rendered = await changeLanguageThroughConsumer(
      createTanstackRuntimeContext(router),
    );

    expect(router.navigate).toHaveBeenCalledWith({
      to: '/cs/podminky-pouzivani?from=test#section',
      replace: true,
    });
  });

  test('keeps React Router positional replacement when changeLanguage updates the URL', async () => {
    window.history.replaceState(null, '', '/en/terms-of-service');
    const router = createMemoryRouter([{ path: '*' }], {
      initialEntries: ['/en/terms-of-service'],
    });
    rstest.spyOn(router, 'navigate').mockResolvedValue(undefined);
    rendered = await changeLanguageThroughConsumer(
      createReactRouterRuntimeContext(router),
    );

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
    const runtimeContext = createReactRouterRuntimeContext(router);
    const { onBeforeRender, wrapRoot } = await collectI18nRuntime(
      i18nInstance,
      true,
    );
    await onBeforeRender(runtimeContext);
    const I18nRoot = wrapRoot(() => <RouterProvider router={router} />);
    rendered = await renderWithRuntime(<I18nRoot />, runtimeContext);

    const translation = () =>
      rendered?.container.querySelector('[data-testid="translation"]')
        ?.textContent;

    await act(async () => {
      rendered?.container
        .querySelector('a')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(translation()).toBe('Jazyk');

    await act(async () => {
      await router.navigate(-1);
    });
    expect(translation()).toBe('Language');
  });
});

test('canonicalizes successive prefixed routes in one mounted provider', async () => {
  const previousTarget = process.env.MODERN_TARGET;
  process.env.MODERN_TARGET = 'browser';
  const instance = createI18nInstance('cs');
  const router = createMutableTanstackRouter('/cs/about');
  router.stores.location.get().searchStr = '?from=test';
  router.stores.location.get().hash = '#section';
  const runtimeContext = createTanstackRuntimeContext(router);
  runtimeContext.i18nInstance = instance;
  const { wrapRoot } = await collectI18nRuntime(instance, false, {
    localisedUrls: {
      '/about': { en: '/about', cs: '/o-nas' },
      ...localisedUrls,
    },
  });
  const Root = wrapRoot(() => <main>CSR content</main>);
  let rendered: { container: HTMLElement; root: Root } | undefined;
  try {
    window.history.replaceState(null, '', '/cs/about?from=test#section');
    rendered = await renderWithRuntime(<Root />, runtimeContext);
    expect(router.navigate).toHaveBeenLastCalledWith({
      to: '/cs/o-nas?from=test#section',
      replace: true,
    });
    await act(async () => {
      window.history.replaceState(null, '', '/cs/terms-of-service');
      router.publishPathname('/cs/terms-of-service');
    });
    expect(router.navigate).toHaveBeenLastCalledWith({
      to: '/cs/podminky-pouzivani',
      replace: true,
    });
  } finally {
    cleanup(rendered);
    window.history.replaceState(null, '', '/');
    if (previousTarget === undefined) delete process.env.MODERN_TARGET;
    else process.env.MODERN_TARGET = previousTarget;
  }
});
