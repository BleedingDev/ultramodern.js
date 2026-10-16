import { createI18nUrlRewrite } from '@modern-js/i18n-runtime-extensions/urlRewrite';
import { renderToString } from '@solidjs/web';
import { createComponent } from 'solid-js';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import {
  LocalizedLink,
  type LocalizedLinkProps,
} from '../../src/i18n/LocalizedLink';
import type { I18nInstanceLike } from '../../src/i18n/types';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  RouterContextProvider,
} from '../../src/router-binding/index';

const languages = ['en', 'cs'];
const localisedUrls = {
  '/products/:slug': { en: '/products/:slug', cs: '/produkty/:slug' },
};

async function renderLink(
  props: LocalizedLinkProps,
  component: typeof LocalizedLink = LocalizedLink,
): Promise<string> {
  const instance: I18nInstanceLike = { language: 'cs', t: key => String(key) };
  const root = createRootRoute();
  const product = createRoute({
    getParentRoute: () => root,
    path: '/products/$slug',
    params: {
      parse: ({ slug }) => ({ slug: slug.replace(/^item-/, '') }),
      stringify: ({ slug }) => ({ slug: `item-${slug}` }),
    },
  });
  const router = createRouter({
    routeTree: root.addChildren([product]),
    history: createMemoryHistory({
      initialEntries: ['/store/cs/produkty/item-current'],
    }),
    basepath: '/store',
    isServer: true,
    rewrite: createI18nUrlRewrite({
      languages,
      localisedUrls,
      getLanguage: () => instance.language,
    }),
  });
  await router.load();
  return renderToString(() =>
    createComponent(RouterContextProvider, {
      router,
      children: () =>
        createComponent(I18nProvider, {
          instance,
          languages,
          localisedUrls,
          get children() {
            return createComponent(component, props);
          },
        }),
    }),
  );
}

describe('native Solid LocalizedLink SSR', () => {
  test('serializes canonical params before localization and forwards anchor attributes', async () => {
    const html = await renderLink({
      to: '/products/$slug',
      params: { slug: 'next' },
      search: { sort: 'price' },
      hash: 'details',
      class: 'product-link',
      'data-product': 'next',
      'aria-label': 'Next product',
      children: 'Next product',
    });

    expect(html).toContain(
      'href="/store/cs/produkty/item-next?sort=price#details"',
    );
    expect(html).toContain('class="product-link"');
    expect(html).toContain('data-product="next"');
    expect(html).toContain('aria-label="Next product"');
    expect(html).toContain('Next product</a>');
    expect(html).not.toContain('hreflang=');
    expect(html).not.toContain('aria-current=');
  });

  test('keeps canonical activity and render children when choosing another language', async () => {
    const html = await renderLink({
      to: '/products/$slug',
      params: { slug: 'current' },
      language: 'en',
      class: 'product-link',
      activeOptions: { exact: true },
      activeProps: { class: 'selected', 'data-selected': 'yes' },
      children: ({ isActive }) =>
        isActive ? 'Current product' : 'Other product',
    });

    expect(html).toContain('href="/store/en/products/item-current"');
    expect(html).toContain('hreflang="en"');
    expect(html).toContain('data-status="active"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('class="product-link selected"');
    expect(html).toContain('data-selected="yes"');
    expect(html).toContain('Current product</a>');
  });

  test.each([
    'https://catalog.example/products/red?sort=price#details',
    '//catalog.example/products/red?sort=price#details',
  ])('preserves the native external target %s', async to => {
    const props: LocalizedLinkProps = {
      to,
      language: 'en',
      target: '_blank',
      rel: 'noopener',
      children: 'External catalog',
    };
    const html = await renderLink(props);
    const nativeHtml = await renderLink(props, Link);

    expect(html.match(/href="([^"]+)"/)?.[1]).toBe(
      nativeHtml.match(/href="([^"]+)"/)?.[1],
    );
    expect(html).toContain(`href="${to}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener"');
    expect(html).toContain('hreflang="en"');
    expect(html).toContain('External catalog</a>');
    expect(html).not.toContain('aria-current=');
  });

  test.each([
    'javascript:alert(1)',
    'java\nscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'blob:https://catalog.example/id',
    '\n//catalog.example/products',
    '/\\catalog.example/products',
  ])('omits unsafe native hrefs during SSR: %s', async to => {
    const warning = rstest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const props: LocalizedLinkProps = { to, children: 'Blocked target' };
      const html = await renderLink(props);
      const nativeHtml = await renderLink(props, Link);
      expect(html).not.toContain('href=');
      expect(nativeHtml).not.toContain('href=');
      expect(html).not.toContain('aria-current=');
      expect(warning).toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });
});
