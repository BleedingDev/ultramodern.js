import { renderToString, ssr } from '@solidjs/web';
import { createComponent } from 'solid-js';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import type { I18nInstanceLike } from '../../src/i18n/types';
import { useI18n } from '../../src/i18n/useI18n';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '../../src/router-binding/index';

function createFakeI18nInstance(language: string): I18nInstanceLike {
  const translations: Record<string, Record<string, string>> = {
    en: { greeting: 'Hello' },
    cs: { greeting: 'Ahoj' },
  };
  return {
    language,
    t: key => translations[language]?.[key as string] ?? String(key),
    on: () => {},
    off: () => {},
  };
}

function Consumer() {
  const i18n = useI18n();
  return ssr(['<span>', ':', '</span>'], i18n.language(), i18n.t('greeting'));
}

async function renderWithInstance(instance: I18nInstanceLike): Promise<string> {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/en/dashboard'] }),
    isServer: true,
  });
  await router.load();
  return renderToString(() =>
    createComponent(RouterContextProvider, {
      router,
      children: () =>
        createComponent(I18nProvider, {
          instance,
          languages: ['en', 'cs'],
          get children() {
            return createComponent(Consumer, {});
          },
        }),
    }),
  );
}

describe('Solid i18n SSR', () => {
  test('renders the per-request instance translation on the server', async () => {
    const html = await renderWithInstance(createFakeI18nInstance('en'));
    expect(html).toContain('<span>en:Hello</span>');
  });

  test('two concurrent per-request instances never leak into each other', async () => {
    // Sequential awaits still exercise independence: nothing module-scoped
    // should carry state between these two "requests".
    const [englishHtml, czechHtml] = await Promise.all([
      renderWithInstance(createFakeI18nInstance('en')),
      renderWithInstance(createFakeI18nInstance('cs')),
    ]);
    expect(englishHtml).toContain('<span>en:Hello</span>');
    expect(czechHtml).toContain('<span>cs:Ahoj</span>');
  });
});
