import { applyLocalisedUrlsToRoutes } from '@modern-js/i18n-runtime-extensions';
import {
  createMemoryHistory,
  createRouter,
  Outlet,
  RouterProvider,
  useLoaderData,
  useParams,
} from '@tanstack/react-router';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createModernBasepathRewrite } from '../../src/runtime/basepathRewrite';
import { createRouteTreeFromRouteObjects } from '../../src/runtime/routeTree';
import { createTanstackRouteObjectsFromConfig } from '../../src/runtime/utils';
import { navigateOnClient } from './clientNavigation';

function SearchPage() {
  const data = useLoaderData({ from: '/$lang/search' }) as { language: string };
  return createElement('p', null, `search:${data.language}`);
}

function ResourcePage() {
  const params = useParams({ from: '/$lang/resources/$id' }) as { id: string };
  return createElement('p', null, `resource:${params.id}`);
}

test('localized URLs preserve native loader and params route identity in SSR and navigation', async () => {
  const routes = applyLocalisedUrlsToRoutes(
    [
      {
        type: 'nested',
        id: 'lang',
        path: ':lang',
        component: Outlet,
        children: [
          {
            type: 'nested',
            id: 'search',
            path: 'search',
            component: SearchPage,
            loader: ({ params }: { params: { lang: string } }) => ({
              language: params.lang,
            }),
          },
          {
            type: 'nested',
            id: 'resource',
            path: 'resources/:id',
            component: ResourcePage,
          },
        ],
      },
    ],
    ['en', 'cs'],
    {
      '/search': { en: '/find', cs: '/hledat' },
      '/resources/:id': { en: '/resources/:id', cs: '/zdroje/:id' },
    },
    'canonical',
  );
  const routeObjects = createTanstackRouteObjectsFromConfig({
    routesConfig: { routes },
  })!;
  const history = createMemoryHistory({
    initialEntries: ['/base/cs/hledat?q=tractor#results'],
  });
  const router = createRouter({
    context: {
      request: new Request(
        'https://example.test/base/cs/hledat?q=tractor#results',
      ),
    },
    routeTree: createRouteTreeFromRouteObjects(routeObjects),
    history,
    rewrite: createModernBasepathRewrite('/base', false, routeObjects),
  });
  await router.load();
  expect(router.state.matches.at(-1)?.routeId).toBe('/$lang/search');
  expect(renderToString(createElement(RouterProvider, { router }))).toContain(
    'search:cs',
  );
  expect(history.location.href).toBe('/base/cs/hledat?q=tractor#results');

  await navigateOnClient(router, {
    to: '/en/search',
    search: { q: 'tractor' },
  });
  expect(history.location.href).toBe('/base/en/find?q=tractor');
  expect(router.state.matches.at(-1)?.routeId).toBe('/$lang/search');
  expect(renderToString(createElement(RouterProvider, { router }))).toContain(
    'search:en',
  );

  await navigateOnClient(router, { to: '/cs/zdroje/a%2Fb' });
  expect(history.location.href).toBe('/base/cs/zdroje/a%2Fb');
  expect(router.state.matches.at(-1)?.routeId).toBe('/$lang/resources/$id');
  expect(renderToString(createElement(RouterProvider, { router }))).toContain(
    'resource:a/b',
  );
});
