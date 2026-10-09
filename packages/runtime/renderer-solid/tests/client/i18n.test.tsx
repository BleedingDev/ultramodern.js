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
      // A blocked or failed navigation keeps the page's URL and language.
      const realNavigate = router.navigate.bind(router);
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
      // A switch that fails after a later one succeeded leaves the later
      // language in place.
      let failFirst!: (error: Error) => void;
      let calls = 0;
      router.navigate = ((options: never) =>
        ++calls === 1
          ? new Promise((_resolve, reject) => {
              failFirst = reject;
            })
          : realNavigate(options)) as never;
      const first = binding!.changeLanguage('en');
      // The newer switch starts while the older one is navigating.
      for (let tick = 0; calls === 0 && tick < 100; tick += 1)
        await Promise.resolve();
      // It waits for that navigation, which then fails.
      const newer = binding!.changeLanguage('en');
      failFirst(new Error('stale navigation'));
      await expect(first).rejects.toThrow('stale navigation');
      await newer;
      expect(router.state.location.href).toBe(
        '/en/products?sort=price#reviews',
      );
      expect(instance.language).toBe('en');
      // A slow language load that settles after a newer switch neither
      // navigates nor keeps its language.
      router.navigate = realNavigate as never;
      const fastChange = instance.changeLanguage!;
      let finishSlow!: () => void;
      instance.changeLanguage = async (lng?: string) => {
        if (lng === 'cs')
          await new Promise<void>(resolve => {
            finishSlow = resolve;
          });
        return fastChange(lng);
      };
      const slow = binding!.changeLanguage('cs');
      await binding!.changeLanguage('en');
      finishSlow();
      await slow;
      expect(router.state.location.href).toBe(
        '/en/products?sort=price#reviews',
      );
      expect(instance.language).toBe('en');
      // Three switches settle out of order, including a stale call's own
      // correction; the language still ends on the newest switch and URL.
      const pending: (() => void)[] = [];
      instance.changeLanguage = async (lng?: string) => {
        await new Promise<void>(resolve => {
          pending.push(resolve);
        });
        return fastChange(lng);
      };
      const ticks = async () => {
        for (let tick = 0; tick < 50; tick += 1) await Promise.resolve();
      };
      const oldest = binding!.changeLanguage('cs');
      const middle = binding!.changeLanguage('en');
      pending[1]();
      await middle;
      // The oldest load settles and starts correcting toward the middle one.
      pending[0]();
      await ticks();
      const newest = binding!.changeLanguage('cs');
      pending[3]();
      await newest;
      // That correction settles last.
      pending[2]();
      await ticks();
      pending[4]?.();
      await oldest;
      expect(router.state.location.href).toBe(
        '/cs/products?sort=price#reviews',
      );
      expect(instance.language).toBe('cs');
      instance.changeLanguage = fastChange;
      // An older navigation that commits late cannot leave its URL behind:
      // the newer switch navigates after it.
      let releaseOlder!: () => void;
      let navigations = 0;
      router.navigate = ((options: never) =>
        ++navigations === 1
          ? new Promise(resolve => {
              releaseOlder = () => resolve(realNavigate(options));
            })
          : realNavigate(options)) as never;
      const older = binding!.changeLanguage('en');
      for (let tick = 0; navigations === 0 && tick < 100; tick += 1)
        await Promise.resolve();
      const latest = binding!.changeLanguage('cs');
      await ticks();
      releaseOlder();
      await Promise.all([older, latest]);
      expect(router.state.location.href).toBe(
        '/cs/products?sort=price#reviews',
      );
      expect(instance.language).toBe('cs');
      // A newer switch whose navigation is blocked restores the language;
      // an older load settling afterwards converges on that restored one.
      router.navigate = (async () => undefined) as never;
      let releaseOlderLoad!: () => void;
      let loads = 0;
      instance.changeLanguage = async (lng?: string) => {
        if (++loads === 1)
          await new Promise<void>(resolve => {
            releaseOlderLoad = resolve;
          });
        return fastChange(lng);
      };
      const olderLoad = binding!.changeLanguage('en');
      await binding!.changeLanguage('en');
      expect(instance.language).toBe('cs');
      releaseOlderLoad();
      await olderLoad;
      expect(instance.language).toBe('cs');
      expect(router.state.location.href).toBe(
        '/cs/products?sort=price#reviews',
      );
      instance.changeLanguage = fastChange;
      router.navigate = realNavigate as never;
      // Overlapping switches whose navigations are both blocked restore the
      // language the URL renders, not one captured mid-navigation.
      let releaseFirstNavigation!: () => void;
      let blocked = 0;
      router.navigate = (() =>
        ++blocked === 1
          ? new Promise<void>(resolve => {
              releaseFirstNavigation = resolve;
            })
          : Promise.resolve()) as never;
      const firstBlocked = binding!.changeLanguage('en');
      for (let tick = 0; blocked === 0 && tick < 100; tick += 1)
        await Promise.resolve();
      const secondBlocked = binding!.changeLanguage('fr');
      await ticks();
      releaseFirstNavigation();
      await Promise.all([firstBlocked, secondBlocked]);
      expect(router.state.location.href).toBe(
        '/cs/products?sort=price#reviews',
      );
      expect(instance.language).toBe('cs');
      router.navigate = realNavigate as never;
      // A navigation redirected to another locale's URL leaves the language
      // on the locale that URL represents.
      router.navigate = ((options: never) =>
        realNavigate({
          ...(options as object),
          href: '/en/login',
        } as never)) as never;
      await binding!.changeLanguage('cs');
      expect(router.state.location.pathname).toBe('/en/login');
      expect(instance.language).toBe('en');
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
