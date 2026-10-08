import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  DATA_CONTENT_TYPE,
  PRERENDERED_DOCUMENT_META,
  staticDataPayloadPath,
} from '@modern-js/renderer-core/data';
import type { ServerRoute } from '@modern-js/types';
import {
  collectLoaderRouteIds,
  flattenPrerenderRoutes,
  localizePrerenderRoutes,
  markPrerenderedDocument,
  nativePrerenderPlugin,
  type PrerenderRouteNode,
  prerenderRoute,
  resolveEntrySsgOptions,
  resolvePrerenderRoutes,
} from '../../src/native-composition/native-prerender';
import { resolveNativeRendererAdapter } from '../../src/native-composition/renderer-registration';

const tree: PrerenderRouteNode[] = [
  {
    id: 'layout',
    path: '/',
    file: 'routes/layout.tsx',
    data: 'routes/layout.data.ts',
    children: [
      {
        id: 'page',
        index: true,
        file: 'routes/page.tsx',
        data: 'routes/page.data.ts',
      },
      { id: 'about/page', path: 'about', file: 'routes/about/page.tsx' },
      {
        id: 'items/(id)/page',
        path: 'items/:id',
        file: 'routes/items/[id]/page.tsx',
        data: 'routes/items/[id]/page.data.ts',
      },
    ],
  },
];

const pageRoute = (
  entryName: string,
  urlPath: string,
  extra: Partial<ServerRoute> = {},
): ServerRoute => ({
  entryName,
  urlPath,
  entryPath: `html/${entryName}/index.html`,
  isSPA: true,
  bundle: `bundles/${entryName}.js`,
  ...extra,
});

describe('native prerender route selection', () => {
  it('derives static document paths and loader route IDs from native routes', () => {
    expect(flattenPrerenderRoutes(tree)).toEqual(['/', '/about', '/items/:id']);
    expect(collectLoaderRouteIds(tree)).toEqual([
      'layout',
      'page',
      'items/(id)/page',
    ]);
  });

  it('normalizes ssg and ssgByEntries options like plugin-ssg', () => {
    const pageRoutes = [pageRoute('index', '/'), pageRoute('admin', '/admin')];
    expect(
      resolveEntrySsgOptions({
        ssg: true,
        entryNames: ['index', 'admin'],
        pageRoutes,
      }),
    ).toEqual({ index: true, admin: true });
    expect(
      resolveEntrySsgOptions({
        ssg: (entryName, { baseUrl }) => ({
          routes: [`/${entryName}`],
          headers: { base: String(baseUrl) },
        }),
        entryNames: ['index'],
        pageRoutes,
        baseUrl: '/base',
      }),
    ).toEqual({ index: { routes: ['/index'], headers: { base: '/base' } } });
    expect(
      resolveEntrySsgOptions({
        ssg: true,
        ssgByEntries: { admin: false, index: () => true },
        entryNames: ['index', 'admin'],
        pageRoutes,
      }),
    ).toEqual({ admin: false, index: true });
    expect(
      resolveEntrySsgOptions({ ssg: false, entryNames: ['index'], pageRoutes }),
    ).toBeUndefined();
  });

  it('prerenders static file-system routes into the plugin-ssg output layout', () => {
    const routes = resolvePrerenderRoutes({
      pageRoutes: [pageRoute('index', '/')],
      entryOptions: { index: true },
      routeTrees: new Map([['index', tree]]),
    });
    expect(routes.map(route => [route.urlPath, route.output])).toEqual([
      ['/', path.join('html', 'index', 'index.html')],
      ['/about', path.join('html/index/about/index.html')],
    ]);
  });

  it('prerenders explicit dynamic routes and custom outputs with headers', () => {
    const routes = resolvePrerenderRoutes({
      pageRoutes: [pageRoute('shop', '/shop')],
      entryOptions: {
        shop: {
          headers: { 'x-shop': '1' },
          routes: [
            '/items/42',
            { url: '/feed', output: 'feed.html', headers: { 'x-feed': '1' } },
          ],
        },
      },
      routeTrees: new Map([['shop', tree]]),
    });
    expect(
      routes.map(route => [route.urlPath, route.output, route.headers]),
    ).toEqual([
      [
        '/shop/items/42',
        path.join('html/shop/items/42/index.html'),
        { 'x-shop': '1' },
      ],
      ['/shop/feed', 'feed.html', { 'x-shop': '1', 'x-feed': '1' }],
    ]);
  });

  it('expands canonical documents per native i18n language', () => {
    const routes = localizePrerenderRoutes(
      resolvePrerenderRoutes({
        pageRoutes: [pageRoute('index', '/')],
        entryOptions: {
          index: {
            routes: [
              '/',
              '/about',
              '/health',
              '/cs/kontakt',
              '/CS/velka',
              { url: '/feed', output: 'feed.html' },
            ],
          },
        },
        routeTrees: new Map([['index', tree]]),
      }),
      {
        languages: ['en', 'cs'],
        ignoreRedirectRoutes: ['/health'],
        localisedUrls: { about: { en: 'about', cs: 'o-nas' } },
      },
    );
    expect(routes.map(route => [route.urlPath, route.output])).toEqual([
      ['/en', path.join('html/index/en/index.html')],
      ['/cs', path.join('html/index/cs/index.html')],
      ['/en/about', path.join('html/index/en/about/index.html')],
      ['/cs/o-nas', path.join('html/index/cs/o-nas/index.html')],
      ['/health', path.join('html/index/health/index.html')],
      ['/cs/kontakt', path.join('html/index/cs/kontakt/index.html')],
      ['/CS/velka', path.join('html/index/CS/velka/index.html')],
      ['/en/feed', path.join('en', 'feed.html')],
      ['/cs/feed', path.join('cs', 'feed.html')],
    ]);
  });

  it('rejects SSG for a server-rendered origin route', () => {
    expect(() =>
      resolvePrerenderRoutes({
        pageRoutes: [pageRoute('index', '/', { isSSR: true })],
        entryOptions: { index: true },
        routeTrees: new Map([['index', tree]]),
      }),
    ).toThrow(
      'Static site generation cannot be combined with SSR for the same route: url /, entry index',
    );
  });

  it('marks the document head for static payload replay', () => {
    expect(
      markPrerenderedDocument(
        '<html><head><title>x</title></head><body></body></html>',
      ),
    ).toBe(
      `<html><head><title>x</title><meta name="${PRERENDERED_DOCUMENT_META}" content="static-data"></head><body></body></html>`,
    );
    expect(() => markPrerenderedDocument('<div></div>')).toThrow('<head>');
  });

  it('runs after the native build owner and before release stamping', () => {
    const plugin = nativePrerenderPlugin(resolveNativeRendererAdapter('solid'));
    expect(plugin.pre).toEqual(['@modern-js/renderer-solid-infrastructure']);
    expect(plugin.post).toEqual([
      '@modern-js/renderer-build-artifact-stamp',
      '@modern-js/ultramodern-release-envelope',
    ]);
  });
});

describe('native prerender output', () => {
  let distDirectory: string;
  beforeEach(async () => {
    distDirectory = await fs.mkdtemp(
      path.join(process.env.OWNED_TEMP_DIR ?? os.tmpdir(), 'um-prerender-'),
    );
  });
  afterEach(async () => {
    await fs.rm(distDirectory, { recursive: true, force: true });
  });

  const [route] = resolvePrerenderRoutes({
    pageRoutes: [pageRoute('index', '/')],
    entryOptions: { index: { routes: ['/items/42'] } },
    routeTrees: new Map([['index', tree]]),
  });

  it('writes the rendered document and matching loader payloads', async () => {
    const requests: string[] = [];
    await prerenderRoute({
      route,
      entry: {} as never,
      loaderRouteIds: ['layout', 'items/(id)/page'],
      distDirectory,
      async dispatch(_entry, request) {
        const url = new URL(request.url);
        requests.push(url.pathname + url.search);
        const loader = url.searchParams.get('__loader');
        if (!loader)
          return new Response(
            '<!doctype html><html><head></head><body><div id="root">Item 42</div><script type="module" src="/static/js/index.js"></script></body></html>',
            { headers: { 'content-type': 'text/html; charset=utf-8' } },
          );
        if (loader === 'layout')
          return new Response('Data route is not authorized for this URL', {
            status: 403,
          });
        return new Response('{"item":42}', {
          headers: { 'content-type': DATA_CONTENT_TYPE },
        });
      },
    });
    expect(requests).toEqual([
      '/items/42',
      '/items/42?__loader=layout&__ssrDirect=true',
      '/items/42?__loader=items%2F%28id%29%2Fpage&__ssrDirect=true',
    ]);
    const html = await fs.readFile(
      path.join(distDirectory, 'html/index/items/42/index.html'),
      'utf8',
    );
    expect(html).toContain('Item 42');
    expect(html).toContain('/static/js/index.js');
    expect(html).toContain(`name="${PRERENDERED_DOCUMENT_META}"`);
    const payloadFile = path.join(
      distDirectory,
      'html/index',
      ...staticDataPayloadPath('/items/42', 'items/(id)/page').split('/'),
    );
    expect(JSON.parse(await fs.readFile(payloadFile, 'utf8'))).toEqual({
      status: 200,
      contentType: DATA_CONTENT_TYPE,
      body: '{"item":42}',
    });
    await expect(
      fs.access(
        path.join(
          distDirectory,
          'html/index',
          ...staticDataPayloadPath('/items/42', 'layout').split('/'),
        ),
      ),
    ).rejects.toThrow();
  });

  it('rejects a file-style URL whose document has loader data', async () => {
    await expect(
      prerenderRoute({
        route: { ...route, urlPath: '/guide.html', output: 'guide.html' },
        entry: {} as never,
        loaderRouteIds: ['page'],
        distDirectory,
        dispatch: async (_entry, request) =>
          new URL(request.url).searchParams.has('__loader')
            ? new Response('{}', {
                headers: { 'content-type': DATA_CONTENT_TYPE },
              })
            : new Response('<html><head></head><body></body></html>', {
                headers: { 'content-type': 'text/html; charset=utf-8' },
              }),
      }),
    ).rejects.toThrow('needs a directory-style URL (for example /guide');
  });

  it('fails the build when a document does not render', async () => {
    await expect(
      prerenderRoute({
        route,
        entry: {} as never,
        loaderRouteIds: [],
        distDirectory,
        dispatch: async () =>
          new Response('boom', {
            status: 500,
            headers: { 'content-type': 'text/html' },
          }),
      }),
    ).rejects.toThrow('Prerendering /items/42 returned HTTP 500');
  });
});
