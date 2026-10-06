import { createElement, createRoot, flushSync } from 'octane';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { LocalizedLink } from '../src/i18n/LocalizedLink';
import type { I18nInstanceLike } from '../src/i18n/types';
import { useI18n } from '../src/i18n/useI18n';
import {
  ApplicationRouter,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '../src/router';

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

describe('Octane i18n binding', () => {
  test('useI18n reads the per-request instance and re-renders on languageChanged', async () => {
    const instance = createFakeI18nInstance('en');
    const router = createRouter({
      routeTree: createRootRoute(),
      history: createMemoryHistory({ initialEntries: ['/en/dashboard'] }),
      isServer: false,
    });
    await router.load();

    const root = document.createElement('div');
    document.body.appendChild(root);

    function Consumer() {
      const i18n = useI18n();
      return createElement(
        'div',
        null,
        createElement('span', { 'data-testid': 'language' }, i18n.language),
        createElement(
          'span',
          { 'data-testid': 'greeting' },
          i18n.t('greeting'),
        ),
        createElement(LocalizedLink, { to: '/products' }, 'Products'),
      );
    }

    const octaneRoot = createRoot(root);
    flushSync(() =>
      octaneRoot.render(
        createElement(
          ApplicationRouter as any,
          { router },
          createElement(
            I18nProvider,
            { instance, languages: ['en', 'cs'] },
            createElement(Consumer),
          ),
        ),
      ),
    );

    try {
      expect(root.querySelector('[data-testid="language"]')?.textContent).toBe(
        'en',
      );
      expect(root.querySelector('[data-testid="greeting"]')?.textContent).toBe(
        'Hello',
      );
      const link = root.querySelector('a');
      expect(link?.getAttribute('href')).toBe('/en/products');

      flushSync(() => instance.emit('cs'));

      expect(root.querySelector('[data-testid="language"]')?.textContent).toBe(
        'cs',
      );
      expect(root.querySelector('[data-testid="greeting"]')?.textContent).toBe(
        'Ahoj',
      );
      expect(root.querySelector('a')?.getAttribute('href')).toBe(
        '/cs/products',
      );
    } finally {
      octaneRoot.unmount();
      root.remove();
    }
  });
});
