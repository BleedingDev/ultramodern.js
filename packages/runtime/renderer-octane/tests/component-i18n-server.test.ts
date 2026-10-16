import { createNativeI18n } from '@modern-js/i18n-runtime-extensions/native';
import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import { createRequestSession } from '@modern-js/renderer-core/session';
import {
  createRequestHandler,
  createSsrStreamResponse,
  RouterServer,
} from '@octanejs/tanstack-router/ssr/server';
import { expect, rstest, test } from '@rstest/core';
import { createElement } from 'octane/server';
import { createNativeServerEntry } from '../src/entry-server';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { LocalizedLink } from '../src/i18n/LocalizedLink';
import { useI18n } from '../src/i18n/useI18n';
import {
  OCTANE_COMPILER_VERSION,
  OCTANE_RUNTIME_VERSION,
} from '../src/manifest';
import { createRootRoute, createRoute, createRouter } from '../src/router';
import { createOctaneRouterInjection } from '../src/router-injection';
import { renderOctaneApplication } from '../src/server';

test('a component-only entry renders with its request localization instance and handoff', async () => {
  const identity: RendererIdentity = {
    renderer: 'octane',
    appId: 'component-store',
    entryName: 'main',
    protocolVersion: 1,
    buildId: 'component-build',
  };
  const instance = { language: 'cs', t: () => 'Ahoj' };
  let renderedInstance: unknown;
  const create = rstest.fn(async () => instance);
  const handoff = rstest.fn((language: string, resolved?: typeof instance) => ({
    id: 'component-i18n',
    payload: JSON.stringify({
      language,
      resources: { translation: { greeting: resolved?.t() } },
    }),
  }));
  const entry = createNativeServerEntry({
    identity,
    app: async () => ({
      default: () => {
        const i18n = useI18n();
        renderedInstance = i18n.instance;
        return createElement(
          'main',
          null,
          `${i18n.language}: ${i18n.t('greeting')}`,
        );
      },
    }),
    i18n: {
      languages: ['en', 'cs'],
      resolveRequest: () => ({ kind: 'language', language: 'cs' }),
      redirect: location => Response.redirect(location),
      create,
      rewrite: () => ({}),
      handoff,
      clientHandoff: () => ({ language: 'cs' }),
      syncWithRouter: () => {},
    },
  });
  const request = new Request('https://component.test/cs/');
  const session = createRequestSession({
    request,
    identity,
    platform: { kind: 'node', bindings: {} },
  });
  const response = await entry.nativeRequestHandler(request, {
    session,
    entry: identity,
    nativeManifest: {
      schemaVersion: 1,
      renderer: 'octane',
      runtimeVersion: OCTANE_RUNTIME_VERSION,
      compilerVersion: OCTANE_COMPILER_VERSION,
      rendererIdentity: identity,
      nativeHydrationBuildId: 'native-component-build',
      sourceModules: [
        {
          resource: 'src/App.tsrx',
          canonicalId: 'component-store:src/App.tsrx',
          moduleId: './src/App.tsrx',
          transformKind: 'compile',
          emittedSourceSha256: 'b'.repeat(64),
          assets: ['static/js/main.js'],
        },
      ],
      assets: [{ file: 'static/js/main.js', sha256: 'c'.repeat(64) }],
    },
  });
  const html = await response.text();

  expect(create).toHaveBeenCalledExactlyOnceWith('cs');
  expect(renderedInstance).toBe(instance);
  expect(handoff).toHaveBeenCalledExactlyOnceWith('cs', instance);
  expect(html).toContain('<html lang="cs">');
  expect(html).toContain('<main>cs: Ahoj</main>');
  expect(html).toContain('"resources":{"translation":{"greeting":"Ahoj"}}');
});

test('native localized SSR links retain their requested language, route params and active props', async () => {
  const identity: RendererIdentity = {
    renderer: 'octane',
    appId: 'localized-link-store',
    entryName: 'main',
    protocolVersion: 1,
    buildId: 'localized-link-build',
  };
  const localization = createNativeI18n(
    {
      languages: ['en', 'cs'],
      fallbackLanguage: 'en',
      basePath: '/store',
      detect: false,
      localisedUrls: {
        '/products/:slug': { en: '/products/:slug', cs: '/produkty/:slug' },
      },
    },
    {},
  );
  const instance = await localization.create('en');
  const rootRoute = createRootRoute({
    component: () =>
      createElement(I18nProvider, {
        instance,
        languages: localization.languages,
        localisedUrls: localization.localisedUrls,
        children: createElement(
          LocalizedLink,
          {
            to: '/products/$slug',
            params: { slug: 'RED' },
            language: 'cs',
            search: { sort: 'price' },
            hash: 'details',
            activeOptions: { exact: true, includeHash: true },
            activeProps: { 'data-locale-link': 'active' },
          },
          'Česky',
        ),
      }),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/products/$slug',
        params: {
          stringify: params => ({ slug: String(params.slug).toLowerCase() }),
        },
      }),
    ]),
    basepath: '/store',
    rewrite: localization.rewrite(() => instance.language),
    isServer: true,
  });
  const request = new Request(
    'https://store.test/store/en/products/red?sort=price#details',
  );
  const session = createRequestSession({
    request,
    identity,
    platform: { kind: 'node', bindings: {} },
  });
  const response = await createRequestHandler({
    request,
    createRouter: () => router,
  })(async ({ router }) => {
    const response = await renderOctaneApplication({
      session,
      App: RouterServer,
      props: { router },
      injection: createOctaneRouterInjection(router, session),
      document: {
        documentId: 'localized-link-document',
        nativeHydrationBuildId: 'localized-link-client',
      },
    });
    return createSsrStreamResponse(router, response);
  });
  const html = await response.text();
  expect(html).toContain('href="/store/cs/produkty/red?sort=price#details"');
  expect(html).toContain('hreflang="cs"');
  expect(html).toContain('data-locale-link="active"');
  expect(html).toContain('data-status="active"');
  expect(instance.language).toBe('en');
});
