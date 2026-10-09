import { createNativeI18n } from '@modern-js/i18n-runtime-extensions/native';
import { createI18nUrlRewrite } from '@modern-js/i18n-runtime-extensions/urlRewrite';
import { createSignal, flush } from 'solid-js';
import { mountApplication } from '../../src/client';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import { LocalizedLink } from '../../src/i18n/LocalizedLink';
import { createLatestLanguageSync } from '../../src/i18n/languageSync';
import type { I18nInstanceLike } from '../../src/i18n/types';
import { useI18n } from '../../src/i18n/useI18n';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '../../src/router-binding/index';

function createFakeI18nInstance(language: string): I18nInstanceLike & {
  emit: (lng: string) => void;
  listenerCount: () => number;
} {
  const listeners = new Set<(lng: string) => void>();
  const translations: Record<string, Record<string, string>> = {
    en: { greeting: 'Hello' },
    cs: { greeting: 'Ahoj' },
  };
  const instance: I18nInstanceLike & {
    emit: (lng: string) => void;
    listenerCount: () => number;
  } = {
    language,
    t: key => translations[instance.language]?.[key as string] ?? String(key),
    changeLanguage: async (lng?: string) => {
      if (!lng) return;
      instance.language = lng;
      for (const listener of listeners) listener(lng);
    },
    on: (event, callback) => {
      if (event === 'languageChanged') listeners.add(callback);
    },
    off: (event, callback) => {
      if (event === 'languageChanged') listeners.delete(callback);
    },
    emit: (lng: string) => {
      instance.language = lng;
      for (const listener of listeners) listener(lng);
    },
    listenerCount: () => listeners.size,
  };
  return instance;
}

function Consumer() {
  const i18n = useI18n();
  return (
    <div>
      <span data-testid="language">{i18n.language()}</span>
      <span data-testid="greeting">{i18n.t('greeting')}</span>
      <LocalizedLink to="/products" data-testid="products-link">
        Products
      </LocalizedLink>
    </div>
  );
}

async function mountConsumer(
  instance: ReturnType<typeof createFakeI18nInstance>,
) {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/en/dashboard'] }),
    isServer: false,
  });
  await router.load();
  const root = document.createElement('div');
  document.body.appendChild(root);
  const dispose = mountApplication(
    () => (
      <RouterContextProvider router={router}>
        {() => (
          <I18nProvider instance={instance} languages={['en', 'cs']}>
            <Consumer />
          </I18nProvider>
        )}
      </RouterContextProvider>
    ),
    root,
  );
  flush();
  return { root, dispose };
}

describe('Solid i18n binding', () => {
  test('changeLanguage keeps the query and fragment of the current URL', async () => {
    const instance = createFakeI18nInstance('en');
    let binding: ReturnType<typeof useI18n> | undefined;
    function Capture() {
      binding = useI18n();
      return null;
    }
    const router = createRouter({
      routeTree: createRootRoute(),
      history: createMemoryHistory({
        initialEntries: ['/en/products?sort=price#reviews'],
      }),
      isServer: false,
    });
    await router.load();
    const root = document.createElement('div');
    const dispose = mountApplication(
      () => (
        <RouterContextProvider router={router}>
          {() => (
            <I18nProvider instance={instance} languages={['en', 'cs', 'fr']}>
              <Capture />
            </I18nProvider>
          )}
        </RouterContextProvider>
      ),
      root,
    );
    try {
      flush();
      await binding!.changeLanguage('cs');
      expect(router.state.location.href).toBe(
        '/cs/products?sort=price#reviews',
      );
      // An unconfigured language changes neither the instance nor the URL;
      // a configured one is matched case-insensitively.
      await expect(binding!.changeLanguage('de')).rejects.toThrow(
        'Unsupported language "de"; expected one of: en, cs, fr',
      );
      expect(instance.language).toBe('cs');
      expect(router.state.location.href).toBe(
        '/cs/products?sort=price#reviews',
      );
      await binding!.changeLanguage('FR');
      expect(instance.language).toBe('fr');
      expect(router.state.location.href).toBe(
        '/fr/products?sort=price#reviews',
      );
      await binding!.changeLanguage('cs');
      // A blocked or failed navigation keeps the page's URL and language.
      const realNavigate = router.navigate.bind(router);
      const fastChange = instance.changeLanguage!;
      const ticks = async () => {
        for (let tick = 0; tick < 50; tick += 1) await Promise.resolve();
      };
      router.navigate = (async () => undefined) as never;
      await binding!.changeLanguage('en');
      expect(instance.language).toBe('cs');
      router.navigate = (async () => {
        throw new Error('navigation failed');
      }) as never;
      await expect(binding!.changeLanguage('en')).rejects.toThrow(
        'navigation failed',
      );
      expect(instance.language).toBe('cs');
      expect(router.state.location.href).toBe(
        '/cs/products?sort=price#reviews',
      );
      router.navigate = realNavigate as never;
      // A failed language load keeps the committed language.
      instance.changeLanguage = async (lng?: string) => {
        if (lng === 'en') throw new Error('load failed');
        return fastChange(lng);
      };
      await expect(binding!.changeLanguage('en')).rejects.toThrow(
        'load failed',
      );
      expect(instance.language).toBe('cs');
      // Switches run one at a time; one that a newer switch supersedes
      // before it starts is skipped.
      const loaded: (string | undefined)[] = [];
      let finishSlow!: () => void;
      instance.changeLanguage = async (lng?: string) => {
        loaded.push(lng);
        if (lng === 'en')
          await new Promise<void>(resolve => {
            finishSlow = resolve;
          });
        return fastChange(lng);
      };
      const slow = binding!.changeLanguage('en');
      await ticks();
      const superseded = binding!.changeLanguage('fr');
      const newest = binding!.changeLanguage('cs');
      finishSlow();
      await Promise.all([slow, superseded, newest]);
      expect(loaded).toEqual(['en', 'cs']);
      expect(router.state.location.href).toBe(
        '/cs/products?sort=price#reviews',
      );
      expect(instance.language).toBe('cs');
      // A newer switch whose load rejects leaves the language the older
      // switch committed with its URL.
      let finishOlder!: () => void;
      instance.changeLanguage = async (lng?: string) => {
        if (lng === 'en')
          await new Promise<void>(resolve => {
            finishOlder = resolve;
          });
        if (lng === 'fr') throw new Error('fr unavailable');
        return fastChange(lng);
      };
      const older = binding!.changeLanguage('en');
      await ticks();
      const rejected = binding!.changeLanguage('fr');
      finishOlder();
      await older;
      await expect(rejected).rejects.toThrow('fr unavailable');
      expect(router.state.location.href).toBe(
        '/en/products?sort=price#reviews',
      );
      expect(instance.language).toBe('en');
      instance.changeLanguage = fastChange;
      // On a route without a locale prefix, overlapping blocked switches
      // keep the language that route was committed with.
      await realNavigate({ to: '.', href: '/login', replace: true } as never);
      await fastChange('cs');
      let releaseFirst!: () => void;
      let navigations = 0;
      router.navigate = (() =>
        ++navigations === 1
          ? new Promise<void>(resolve => {
              releaseFirst = resolve;
            })
          : Promise.resolve()) as never;
      const first = binding!.changeLanguage('en');
      for (let tick = 0; navigations === 0 && tick < 100; tick += 1)
        await Promise.resolve();
      const second = binding!.changeLanguage('fr');
      releaseFirst();
      await Promise.all([first, second]);
      expect(router.state.location.pathname).toBe('/login');
      expect(instance.language).toBe('cs');
      // A navigation redirected to another locale's URL leaves the language
      // on the locale that URL represents, matched case-insensitively.
      router.navigate = ((options: never) =>
        realNavigate({
          ...(options as object),
          href: '/en/login',
        } as never)) as never;
      await binding!.changeLanguage('cs');
      expect(router.state.location.pathname).toBe('/en/login');
      expect(instance.language).toBe('en');
      router.navigate = ((options: never) =>
        realNavigate({
          ...(options as object),
          href: '/CS/login',
        } as never)) as never;
      await binding!.changeLanguage('fr');
      expect(router.state.location.pathname).toBe('/CS/login');
      expect(instance.language).toBe('cs');
      router.navigate = realNavigate as never;
    } finally {
      dispose();
      flush();
    }
  });

  test('changeLanguage keeps the router basepath', async () => {
    const instance = createFakeI18nInstance('en');
    let binding: ReturnType<typeof useI18n> | undefined;
    function Capture() {
      binding = useI18n();
      return null;
    }
    const router = createRouter({
      routeTree: createRootRoute(),
      history: createMemoryHistory({
        initialEntries: ['/store/en/products?sort=price'],
      }),
      basepath: '/store',
      isServer: false,
    });
    await router.load();
    const root = document.createElement('div');
    const dispose = mountApplication(
      () => (
        <RouterContextProvider router={router}>
          {() => (
            <I18nProvider instance={instance} languages={['en', 'cs']}>
              <Capture />
            </I18nProvider>
          )}
        </RouterContextProvider>
      ),
      root,
    );
    try {
      flush();
      await binding!.changeLanguage('cs');
      expect(router.history.location.pathname).toBe('/store/cs/products');
      expect(router.history.location.search).toBe('?sort=price');
      expect(instance.language).toBe('cs');
    } finally {
      dispose();
      flush();
    }
  });

  test('changeLanguage under the i18n URL rewrite follows the public locale URL', async () => {
    const instance = createFakeI18nInstance('cs');
    let binding: ReturnType<typeof useI18n> | undefined;
    function Capture() {
      binding = useI18n();
      return null;
    }
    const languages = ['en', 'cs', 'fr'];
    const router = createRouter({
      routeTree: createRootRoute(),
      history: createMemoryHistory({
        initialEntries: ['/store/cs/products?sort=price'],
      }),
      basepath: '/store',
      rewrite: createI18nUrlRewrite({
        languages,
        getLanguage: () => instance.language,
      }),
      isServer: false,
    });
    await router.load();
    // The router matches the canonical path; only the public URL is localized.
    expect(router.state.location.pathname).toBe('/products');
    const root = document.createElement('div');
    const dispose = mountApplication(
      () => (
        <RouterContextProvider router={router}>
          {() => (
            <I18nProvider instance={instance} languages={languages}>
              <Capture />
            </I18nProvider>
          )}
        </RouterContextProvider>
      ),
      root,
    );
    const publicLanguage = () => router.history.location.pathname.split('/')[2];
    try {
      flush();
      await binding!.changeLanguage('fr');
      expect(router.history.location.pathname).toBe('/store/fr/products');
      expect(router.history.location.search).toBe('?sort=price');
      expect(instance.language).toBe('fr');
      // A switch redirected to another page keeps the language of the URL
      // the user lands on.
      const realNavigate = router.navigate.bind(router);
      router.navigate = ((options: never) =>
        realNavigate({
          ...(options as object),
          href: '/en/login',
        } as never)) as never;
      await binding!.changeLanguage('cs');
      router.navigate = realNavigate as never;
      expect(router.state.location.pathname).toBe('/login');
      expect(instance.language).toBe(publicLanguage());
    } finally {
      dispose();
      flush();
    }
  });

  test('provider replacement releases the old language subscription and disposal releases the current one', () => {
    const first = createFakeI18nInstance('en');
    const second = createFakeI18nInstance('cs');
    const [instance, setInstance] = createSignal(first);
    const root = document.createElement('div');
    const dispose = mountApplication(
      () => (
        <I18nProvider instance={instance()} languages={['en', 'cs']}>
          <span />
        </I18nProvider>
      ),
      root,
    );
    try {
      flush();
      expect(first.listenerCount()).toBe(1);
      setInstance(second);
      flush();
      expect(first.listenerCount()).toBe(0);
      expect(second.listenerCount()).toBe(1);
    } finally {
      dispose();
      flush();
    }
    expect(second.listenerCount()).toBe(0);
  });

  test('language synchronization releases retry listeners after intent changes and disposal', () => {
    const target = createFakeI18nInstance('en');
    const [desiredLanguage, setDesiredLanguage] = createSignal('en');
    const addOnline = rstest.spyOn(window, 'addEventListener');
    const removeOnline = rstest.spyOn(window, 'removeEventListener');
    const addVisibility = rstest.spyOn(document, 'addEventListener');
    const removeVisibility = rstest.spyOn(document, 'removeEventListener');
    const root = document.createElement('div');
    const dispose = mountApplication(() => {
      createLatestLanguageSync({
        target: () => target,
        desiredLanguage,
        changeLanguage: () => undefined,
        commitLanguage: () => undefined,
      });
      return null;
    }, root);
    try {
      flush();
      const firstOnline = addOnline.mock.calls.find(
        ([type]) => type === 'online',
      )?.[1];
      const firstVisibility = addVisibility.mock.calls.find(
        ([type]) => type === 'visibilitychange',
      )?.[1];
      expect(firstOnline).toBeTypeOf('function');
      expect(firstVisibility).toBeTypeOf('function');
      setDesiredLanguage('cs');
      flush();
      expect(removeOnline).toHaveBeenCalledWith('online', firstOnline);
      expect(removeVisibility).toHaveBeenCalledWith(
        'visibilitychange',
        firstVisibility,
      );
      dispose();
      flush();
      for (const [type, listener] of addOnline.mock.calls) {
        if (type === 'online')
          expect(removeOnline).toHaveBeenCalledWith(type, listener);
      }
      for (const [type, listener] of addVisibility.mock.calls) {
        if (type === 'visibilitychange')
          expect(removeVisibility).toHaveBeenCalledWith(type, listener);
      }
    } finally {
      dispose();
      flush();
      addOnline.mockRestore();
      removeOnline.mockRestore();
      addVisibility.mockRestore();
      removeVisibility.mockRestore();
    }
  });

  test('disposing language synchronization prevents a pending request from committing', async () => {
    const pending = Promise.withResolvers<void>();
    const target = createFakeI18nInstance('en');
    const changeLanguage = rstest.fn(() => pending.promise);
    const commitLanguage = rstest.fn();
    const root = document.createElement('div');
    const dispose = mountApplication(() => {
      createLatestLanguageSync({
        target: () => target,
        desiredLanguage: () => 'cs',
        changeLanguage,
        commitLanguage,
      });
      return null;
    }, root);
    try {
      flush();
      expect(changeLanguage).toHaveBeenCalledWith(target, 'cs');
      dispose();
      pending.resolve();
      await pending.promise;
      await Promise.resolve();
      expect(commitLanguage).not.toHaveBeenCalled();
    } finally {
      dispose();
      pending.resolve();
      flush();
    }
  });

  test('useI18n reads the per-request instance and re-renders on languageChanged', async () => {
    const instance = createFakeI18nInstance('en');
    const { root, dispose } = await mountConsumer(instance);
    try {
      expect(root.querySelector('[data-testid="language"]')?.textContent).toBe(
        'en',
      );
      expect(root.querySelector('[data-testid="greeting"]')?.textContent).toBe(
        'Hello',
      );

      instance.emit('cs');
      flush();

      expect(root.querySelector('[data-testid="language"]')?.textContent).toBe(
        'cs',
      );
      expect(root.querySelector('[data-testid="greeting"]')?.textContent).toBe(
        'Ahoj',
      );
    } finally {
      dispose();
      root.remove();
      flush();
    }
  });

  test('LocalizedLink localizes a canonical target for the current language', async () => {
    const instance = createFakeI18nInstance('en');
    const { root, dispose } = await mountConsumer(instance);
    try {
      const link = root.querySelector('a');
      expect(link?.getAttribute('href')).toBe('/en/products');
      expect(link?.getAttribute('data-testid')).toBe('products-link');

      instance.emit('cs');
      flush();

      const linkAfter = root.querySelector('a');
      expect(linkAfter?.getAttribute('href')).toBe('/cs/products');
    } finally {
      dispose();
      root.remove();
      flush();
    }
  });

  test('two providers with independent instances never share language state', async () => {
    const instanceA = createFakeI18nInstance('en');
    const instanceB = createFakeI18nInstance('cs');
    const a = await mountConsumer(instanceA);
    const b = await mountConsumer(instanceB);
    try {
      expect(
        a.root.querySelector('[data-testid="language"]')?.textContent,
      ).toBe('en');
      expect(
        b.root.querySelector('[data-testid="language"]')?.textContent,
      ).toBe('cs');
      instanceA.emit('cs');
      flush();
      expect(
        a.root.querySelector('[data-testid="language"]')?.textContent,
      ).toBe('cs');
      // Instance B is a separate per-request instance: unaffected by A's change.
      expect(
        b.root.querySelector('[data-testid="language"]')?.textContent,
      ).toBe('cs');
      expect(instanceB.language).toBe('cs');
    } finally {
      a.dispose();
      b.dispose();
      a.root.remove();
      b.root.remove();
      flush();
    }
  });
});

/** The entry's router language synchronization, as `entry-client` wires it. */
function syncLanguage(
  router: ReturnType<typeof createRouter>,
  instance: I18nInstanceLike,
  basePath = '/',
) {
  createNativeI18n(
    { languages: ['en', 'cs'], fallbackLanguage: 'en', basePath },
    {},
  ).syncWithRouter(router, instance as never);
}

describe('Solid i18n binding under the i18n router rewrite', () => {
  test('a link to another language is the native Link with its router props', async () => {
    const instance = createFakeI18nInstance('en');
    const router = createRouter({
      routeTree: createRootRoute(),
      history: createMemoryHistory({
        initialEntries: ['/store/en/dashboard'],
      }),
      basepath: '/store',
      isServer: false,
      rewrite: createI18nUrlRewrite({
        languages: ['en', 'cs'],
        getLanguage: () => instance.language,
      }),
    });
    syncLanguage(router, instance, '/store');
    await router.load();
    const preloadRoute = rstest.spyOn(router, 'preloadRoute');
    const root = document.createElement('div');
    document.body.appendChild(root);
    const dispose = mountApplication(
      () => (
        <RouterContextProvider router={router}>
          {() => (
            <I18nProvider instance={instance} languages={['en', 'cs']}>
              <LocalizedLink
                to="/dashboard"
                language="cs"
                class="switch"
                activeProps={{ class: 'is-active' }}
                inactiveProps={{ class: 'is-inactive' }}
                preload="intent"
              >
                Česky
              </LocalizedLink>
            </I18nProvider>
          )}
        </RouterContextProvider>
      ),
      root,
    );
    flush();
    try {
      const anchor = root.querySelector<HTMLAnchorElement>('a[hreflang="cs"]');
      expect(anchor?.getAttribute('href')).toBe('/store/cs/dashboard');
      // The canonical route is the current one, so the native active state applies.
      expect(anchor?.className).toContain('is-active');
      expect(anchor?.className).not.toContain('is-inactive');
      expect(anchor?.getAttribute('data-status')).toBe('active');

      anchor?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      anchor?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await rstest.waitFor(() => expect(preloadRoute).toHaveBeenCalled());
      expect(preloadRoute.mock.calls[0]?.[0]).toMatchObject({
        to: '/dashboard',
        mask: { to: '/cs/dashboard' },
      });

      const modified = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: 0,
        ctrlKey: true,
      });
      anchor?.dispatchEvent(modified);
      expect(modified.defaultPrevented).toBe(false);

      // Switching the language of the current page still pushes a location.
      anchor?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
      );
      await rstest.waitFor(() => expect(instance.language).toBe('cs'));
      expect(router.history.location.pathname).toBe('/store/cs/dashboard');
      expect(router.history.length).toBe(2);
      expect(router.state.location.pathname).toBe('/dashboard');
    } finally {
      preloadRoute.mockRestore();
      dispose();
      root.remove();
      flush();
    }
  });

  test('same-language links stay in the language; a cross-language link navigates through the router', async () => {
    const instance = createFakeI18nInstance('en');
    const router = createRouter({
      routeTree: createRootRoute(),
      history: createMemoryHistory({ initialEntries: ['/en/dashboard'] }),
      isServer: false,
      rewrite: createI18nUrlRewrite({
        languages: ['en', 'cs'],
        getLanguage: () => instance.language,
      }),
    });
    syncLanguage(router, instance);
    await router.load();
    expect(router.state.location.pathname).toBe('/dashboard');
    const root = document.createElement('div');
    document.body.appendChild(root);
    const dispose = mountApplication(
      () => (
        <RouterContextProvider router={router}>
          {() => (
            <I18nProvider instance={instance} languages={['en', 'cs']}>
              <LocalizedLink to="/products">Products</LocalizedLink>
              <LocalizedLink to="/products" language="cs">
                Česky
              </LocalizedLink>
            </I18nProvider>
          )}
        </RouterContextProvider>
      ),
      root,
    );
    flush();
    try {
      expect(
        root.querySelector('a:not([hreflang])')?.getAttribute('href'),
      ).toBe('/en/products');
      const anchor = root.querySelector<HTMLAnchorElement>('a[hreflang="cs"]');
      expect(anchor?.getAttribute('href')).toBe('/cs/products');
      anchor?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
      );
      await rstest.waitFor(() => expect(instance.language).toBe('cs'));
      flush();
      expect(router.history.location.pathname).toBe('/cs/products');
      expect(router.state.location.pathname).toBe('/products');
      // Once the instance follows, the link is a same-language link.
      expect(
        root.querySelector('a[hreflang="cs"]')?.getAttribute('href'),
      ).toBeUndefined();
    } finally {
      dispose();
      root.remove();
      flush();
    }
  });
});
