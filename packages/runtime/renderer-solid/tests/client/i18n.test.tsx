import { createI18nUrlRewrite } from '@modern-js/i18n-runtime-extensions/urlRewrite';
import { flush } from 'solid-js';
import { mountApplication } from '../../src/client';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import { LocalizedLink } from '../../src/i18n/LocalizedLink';
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
} {
  const listeners = new Set<(lng: string) => void>();
  const translations: Record<string, Record<string, string>> = {
    en: { greeting: 'Hello' },
    cs: { greeting: 'Ahoj' },
  };
  const instance: I18nInstanceLike & { emit: (lng: string) => void } = {
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

describe('Solid i18n binding under the i18n router rewrite', () => {
  test('same-language links stay in the language; a cross-language link switches before navigating', async () => {
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
      for (
        let attempt = 0;
        attempt < 100 && router.state.location.publicHref !== '/cs/products';
        attempt++
      )
        await new Promise(resolve => setTimeout(resolve, 10));
      flush();
      expect(router.state.location.publicHref).toBe('/cs/products');
      expect(router.state.location.pathname).toBe('/products');
      expect(instance.language).toBe('cs');
    } finally {
      dispose();
      root.remove();
      flush();
    }
  });
});
