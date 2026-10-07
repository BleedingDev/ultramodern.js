import { createI18nUrlRewrite } from '@modern-js/i18n-runtime-extensions/urlRewrite';
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

type FakeInstance = ReturnType<typeof createFakeI18nInstance>;

function Consumer() {
  const i18n = useI18n();
  return createElement(
    'div',
    null,
    createElement('span', { 'data-testid': 'language' }, i18n.language),
    createElement('span', { 'data-testid': 'greeting' }, i18n.t('greeting')),
    createElement(LocalizedLink, { to: '/products' }, 'Products'),
    createElement(LocalizedLink, { to: '/products', language: 'cs' }, 'Česky'),
  );
}

/** Mount the provider as the root route component, as generated entries do. */
async function mount(instance: FakeInstance, rewrite: boolean) {
  const router = createRouter({
    routeTree: createRootRoute({
      component: () =>
        createElement(I18nProvider, {
          instance,
          languages: ['en', 'cs'],
          children: createElement(Consumer),
        }),
    }),
    history: createMemoryHistory({ initialEntries: ['/en/dashboard'] }),
    isServer: false,
    ...(rewrite
      ? {
          rewrite: createI18nUrlRewrite({
            languages: ['en', 'cs'],
            getLanguage: () => instance.language,
          }),
        }
      : {}),
  });
  await router.load();
  const root = document.createElement('div');
  document.body.appendChild(root);
  const octaneRoot = createRoot(root);
  flushSync(() =>
    octaneRoot.render(createElement(ApplicationRouter as any, { router })),
  );
  return {
    router,
    root,
    dispose() {
      octaneRoot.unmount();
      root.remove();
    },
  };
}

async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 100 && !check(); attempt++)
    await new Promise(resolve => setTimeout(resolve, 10));
  expect(check()).toBe(true);
}

const text = (root: HTMLElement, id: string) =>
  root.querySelector(`[data-testid="${id}"]`)?.textContent;
const sameLanguageHref = (root: HTMLElement) =>
  root.querySelector('a:not([hreflang])')?.getAttribute('href');

describe('Octane i18n binding', () => {
  test.each([false, true])(
    'useI18n and LocalizedLink follow languageChanged (router rewrite: %s)',
    async rewrite => {
      const instance = createFakeI18nInstance('en');
      const { router, root, dispose } = await mount(instance, rewrite);
      try {
        expect(text(root, 'language')).toBe('en');
        expect(text(root, 'greeting')).toBe('Hello');
        expect(sameLanguageHref(root)).toBe('/en/products');
        if (rewrite) expect(router.state.location.pathname).toBe('/dashboard');

        flushSync(() => instance.emit('cs'));

        expect(text(root, 'language')).toBe('cs');
        expect(text(root, 'greeting')).toBe('Ahoj');
        expect(sameLanguageHref(root)).toBe('/cs/products');
      } finally {
        dispose();
      }
    },
  );

  test('a link to another language switches the instance, then navigates client-side', async () => {
    const instance = createFakeI18nInstance('en');
    const { router, root, dispose } = await mount(instance, true);
    try {
      const anchor = root.querySelector<HTMLAnchorElement>('a[hreflang="cs"]');
      expect(anchor?.getAttribute('href')).toBe('/cs/products');
      anchor?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
      );
      await until(() => router.state.location.publicHref === '/cs/products');
      expect(instance.language).toBe('cs');
      expect(router.state.location.pathname).toBe('/products');
    } finally {
      dispose();
    }
  });
});
