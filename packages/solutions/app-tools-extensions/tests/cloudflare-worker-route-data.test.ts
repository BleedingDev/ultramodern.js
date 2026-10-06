import {
  handleRequest,
  setLoaderRouteIdResolver,
} from '@modern-js/plugin-data-loader/runtime';
import { reporterCtx, storage } from '@modern-js/runtime-utils/node';
import {
  expandLocalisedLoaderRoutes,
  resolveLocalisedLoaderRoute,
} from '@modern-js/server-runtime-extensions/localised-loader';
import { createRouteDataRequestHandler } from '../src/templates/cloudflare-worker-route-data.mjs';

type LoaderArgs = {
  context: { get(key: unknown): unknown };
  params: Record<string, string | undefined>;
  pattern: string;
  request: Request;
  url: URL;
};

const reporter = { reportTiming() {} };
const serverRoutes = [
  { urlPath: '/', entryName: 'index', entryPath: 'index.html', isSSR: true },
  { urlPath: '/app', entryName: 'app', entryPath: 'app.html', isSSR: true },
];

const later = (value: unknown, ms: number) =>
  new Promise(resolve => setTimeout(() => resolve(value), ms));
const laterError = (message: string, ms: number) =>
  new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));

const describeArgs = ({
  context,
  params,
  pattern,
  request,
  url,
}: LoaderArgs) => {
  const store = storage.useContext();
  return {
    method: request.method,
    params,
    pattern,
    url: url.href,
    storageRequest: store.request === request,
    storageHeader: store.headers?.['x-route-data'],
    reporter: context.get(reporterCtx) === reporter,
    loaderContext: context.get('fixture'),
  };
};

// Loader routes in the shape the router code generator emits for
// `route-server-loaders.js`.
const routes = [
  {
    type: 'nested',
    id: 'layout',
    path: '/',
    loader: () => ({ layout: true }),
    children: [
      { type: 'nested', id: 'page', index: true, loader: () => 'index' },
      {
        type: 'nested',
        id: 'user/(id)/layout',
        path: 'user/:id',
        loader: ({ params }: LoaderArgs) => params.id,
        children: [
          {
            type: 'nested',
            id: 'user/(id)/page',
            index: true,
            loader: (args: LoaderArgs) => describeArgs(args),
            action: async ({ request, params }: LoaderArgs) => ({
              id: params.id,
              form: Object.fromEntries(await request.formData()),
            }),
          },
        ],
      },
      { type: 'nested', id: 'no-loader/page', path: 'no-loader' },
      {
        type: 'nested',
        id: 'undefined/page',
        path: 'undefined',
        loader: () => undefined,
      },
      {
        type: 'nested',
        id: 'list/page',
        path: 'list',
        loader: () => [1, 'two', { three: 3 }],
      },
      {
        type: 'nested',
        id: 'null-prototype/page',
        path: 'null-prototype',
        loader: () => Object.assign(Object.create(null), { bare: true }),
      },
      {
        type: 'nested',
        id: 'deferred/page',
        path: 'deferred',
        loader: () => ({
          now: 'now',
          ready: Promise.resolve('ready'),
          later: later('later', 5),
          failed: laterError('deferred failed', 15),
          empty: later(null, 25),
        }),
      },
      {
        type: 'nested',
        id: 'response/page',
        path: 'response',
        loader: () =>
          new Response('custom body', {
            status: 202,
            headers: { 'X-Fixture': 'response' },
          }),
      },
      {
        type: 'nested',
        id: 'redirect/page',
        path: 'redirect',
        loader: () =>
          new Response(null, { status: 302, headers: { Location: '/user/7' } }),
      },
      {
        type: 'nested',
        id: 'relative-redirect/(slug)/page',
        path: 'relative-redirect/:slug',
        loader: () =>
          new Response(null, {
            status: 301,
            headers: { Location: '../details?tab=1' },
          }),
      },
      {
        type: 'nested',
        id: 'thrown-redirect/page',
        path: 'thrown-redirect',
        loader: () => {
          throw new Response(null, {
            status: 307,
            headers: { Location: 'https://example.org/elsewhere' },
          });
        },
      },
      {
        type: 'nested',
        id: 'redirect-without-location/page',
        path: 'redirect-without-location',
        loader: () => new Response(null, { status: 303 }),
      },
      {
        type: 'nested',
        id: 'thrown-response/page',
        path: 'thrown-response',
        loader: () => {
          throw new Response('Gone', { status: 410 });
        },
      },
      {
        type: 'nested',
        id: 'error/page',
        path: 'error',
        loader: () => {
          throw new Error('loader failed');
        },
      },
      {
        type: 'nested',
        id: 'thrown-string/page',
        path: 'thrown-string',
        loader: () => {
          throw 'not an error';
        },
      },
      {
        type: 'nested',
        id: 'thrown-undefined/page',
        path: 'thrown-undefined',
        loader: () => {
          throw undefined;
        },
      },
      {
        type: 'nested',
        id: 'route-error/page',
        path: 'route-error',
        loader: () => {
          throw {
            status: 418,
            statusText: 'Teapot',
            internal: false,
            data: 'short and stout',
          };
        },
      },
      {
        type: 'nested',
        id: 'data-with-init/page',
        path: 'data-with-init',
        loader: () => ({
          type: 'DataWithResponseInit',
          data: { created: true },
          init: { status: 201, headers: { 'X-Fixture': 'data' } },
        }),
      },
      {
        type: 'nested',
        id: 'files/(*)/page',
        path: 'files/*',
        loader: ({ params, pattern }: LoaderArgs) => ({ params, pattern }),
      },
      {
        type: 'nested',
        id: 'optional/(slug)/page',
        path: 'optional/:slug?',
        loader: ({ params }: LoaderArgs) => ({ params }),
      },
      {
        type: 'nested',
        id: 'Case/page',
        path: 'Case',
        caseSensitive: true,
        loader: () => 'case sensitive',
      },
    ],
  },
];

// Canonical localized routes, which loader matching projects to every
// localized URL, as the Node server's localized loader plugin does.
const canonicalLocalisedRoutes = [
  {
    type: 'nested',
    id: 'layout',
    path: '/',
    loader: () => ({ layout: true }),
    children: [
      {
        type: 'nested',
        id: 'search',
        path: ':lang/search',
        loader: ({ params, url }: LoaderArgs) => ({
          lang: params.lang,
          q: url.searchParams.get('q'),
        }),
        modernLocalisedRoute: {
          id: 'search',
          path: ':lang/search',
          canonicalPath: '/search',
          paths: { en: '/search', cs: '/hledat' },
        },
      },
    ],
  },
];

// Physical localized aliases, as emitted for `localisedUrls` apps.
const physicalLocalisedRoutes = [
  {
    type: 'nested',
    id: 'about',
    path: ':lang/about',
    loader: ({ params }: LoaderArgs) => ({ lang: params.lang, page: 'about' }),
    modernCanonicalPath: '/about',
  },
  {
    type: 'nested',
    id: 'about__localised_lang_o-mne',
    path: ':lang/o-mne',
    loader: ({ params }: LoaderArgs) => ({ lang: params.lang, page: 'o-mne' }),
    modernLocalisedRoute: { id: 'about' },
    modernCanonicalPath: '/about',
  },
];

type Snapshot = {
  body: string;
  headers: [string, string][];
  status: number;
  statusText: string;
  timings: string[];
};

const run = async (
  handler: 'node' | 'worker',
  loaderRoutes: unknown[],
  url: string,
  init?: RequestInit,
): Promise<Snapshot | undefined> => {
  const timings: string[] = [];
  const loaderContext = new Map<string, unknown>([['fixture', 'context']]);
  const options = {
    request: new Request(new URL(url, 'https://example.test'), {
      ...init,
      headers: { 'X-Route-Data': 'header', ...init?.headers },
    }),
    serverRoutes: structuredClone(serverRoutes),
    context: {
      loaderContext,
      monitors: { timing: (name: string) => timings.push(name) },
      reporter,
    },
    onTiming: (name: string) => timings.push(name),
  };
  let response: Response | void;
  if (handler === 'node') {
    // The Node server's localized loader plugin registers this resolver.
    setLoaderRouteIdResolver(
      loaderContext,
      resolveLocalisedLoaderRoute,
      expandLocalisedLoaderRoutes,
    );
    response = await handleRequest({
      ...options,
      routes: loaderRoutes,
    } as Parameters<typeof handleRequest>[0]);
  } else {
    response = await createRouteDataRequestHandler(loaderRoutes)(options);
  }
  if (!response) {
    return undefined;
  }
  return {
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers].sort(),
    // Error stacks name the handler that called the loader.
    body: (await response.text()).replace(
      /"stack":"(?:[^"\\]|\\.)*"/g,
      '"stack":"<stack>"',
    ),
    timings,
  };
};

const expectParity = async (
  url: string,
  init?: RequestInit,
  loaderRoutes: unknown[] = routes,
) => {
  const node = await run('node', loaderRoutes, url, init);
  const worker = await run('worker', loaderRoutes, url, init);
  expect(worker).toEqual(node);
  return worker;
};

const withNodeEnv = async <T>(value: string, fn: () => Promise<T>) => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = value;
  try {
    return await fn();
  } finally {
    process.env.NODE_ENV = previous;
  }
};

describe('Cloudflare worker route data handler', () => {
  it('answers loader data like the Node data handler', async () => {
    expect(await expectParity('/?__loader=layout')).toMatchObject({
      status: 200,
      body: '{"layout":true}\n\n',
      headers: expect.arrayContaining([
        ['content-type', 'text/modernjs-deferred; charset=UTF-8'],
        ['x-modernjs-response', 'yes'],
      ]),
      timings: ['server-loader-layout', 'server-loader-navigation'],
    });
    expect(await expectParity('/?__loader=page')).toMatchObject({
      status: 200,
      body: '"index"',
      headers: expect.arrayContaining([
        ['content-type', 'application/json; charset=utf-8'],
      ]),
    });
    for (const url of [
      '/user/42?__loader=user/(id)/layout',
      '/no-loader?__loader=no-loader/page',
      '/undefined?__loader=undefined/page',
      '/list?__loader=list/page',
      '/null-prototype?__loader=null-prototype/page',
      '/response?__loader=response/page',
      '/data-with-init?__loader=data-with-init/page',
      '/Case?__loader=Case/page',
    ]) {
      await expectParity(url);
    }
  });

  it('gives loaders the Node request, params, URL, pattern and context', async () => {
    const snapshot = await expectParity(
      '/user/a%2Fb/?index&__loader=user/(id)/page&__ssrDirect=true#hash',
    );
    expect(snapshot?.body).toContain('"params":{"id":"a/b"}');
    expect(snapshot?.body).toContain('"pattern":"/user/:id"');
    expect(snapshot?.body).toContain(
      '"storageRequest":true,"storageHeader":"header","reporter":true,"loaderContext":"context"',
    );
    await expectParity('/files/a/b%20c?__loader=files/(*)/page');
    await expectParity('/optional?__loader=optional/(slug)/page');
    await expectParity('/optional/value?__loader=optional/(slug)/page');
  });

  it('streams deferred loader data like the Node data handler', async () => {
    const snapshot = await expectParity('/deferred?__loader=deferred/page');
    expect(snapshot?.body).toBe(
      [
        '{"now":"now","ready":"__deferred_promise:ready","later":"__deferred_promise:later","failed":"__deferred_promise:failed","empty":"__deferred_promise:empty"}',
        'data:{"ready":"ready"}',
        'data:{"later":"later"}',
        'error:{"failed":{"message":"deferred failed","stack":"<stack>"}}',
        'data:{"empty":null}',
        '',
      ].join('\n\n'),
    );
  });

  it('encodes redirects like the Node data handler', async () => {
    expect(
      await expectParity('/redirect?__loader=redirect/page'),
    ).toMatchObject({
      status: 204,
      headers: expect.arrayContaining([
        ['x-modernjs-redirect', '/user/7'],
        ['x-modernjs-response', 'yes'],
      ]),
    });
    expect(
      await expectParity(
        '/relative-redirect/item?__loader=relative-redirect/(slug)/page',
      ),
    ).toMatchObject({
      headers: expect.arrayContaining([
        ['x-modernjs-redirect', '/details?tab=1'],
      ]),
    });
    expect(
      await expectParity('/thrown-redirect?__loader=thrown-redirect/page'),
    ).toMatchObject({
      headers: expect.arrayContaining([
        ['x-modernjs-redirect', 'https://example.org/elsewhere'],
      ]),
    });
    // Under an entry basename the client resolves the redirect.
    expect(
      await expectParity('/app/redirect?__loader=redirect/page'),
    ).toMatchObject({
      headers: expect.arrayContaining([['x-modernjs-redirect', '/user/7']]),
    });
    await expectParity(
      '/redirect-without-location?__loader=redirect-without-location/page',
    );
  });

  it('encodes thrown responses and errors like the Node data handler', async () => {
    expect(
      await expectParity('/thrown-response?__loader=thrown-response/page'),
    ).toMatchObject({
      status: 410,
      body: 'Gone',
      headers: expect.arrayContaining([['x-modernjs-catch', 'yes']]),
    });
    expect(await expectParity('/error?__loader=error/page')).toMatchObject({
      status: 500,
      body: '{"message":"loader failed","stack":"<stack>"}',
      headers: expect.arrayContaining([['x-modernjs-error', 'yes']]),
    });
    for (const url of [
      '/thrown-string?__loader=thrown-string/page',
      '/thrown-undefined?__loader=thrown-undefined/page',
      '/route-error?__loader=route-error/page',
      // A loader ID outside the matched route branch.
      '/user/42?__loader=page',
      // A URL without a matching route.
      '/missing/deep/path?__loader=page',
      '/case?__loader=Case/page',
    ]) {
      await expectParity(url);
    }
    await withNodeEnv('production', async () => {
      expect(await expectParity('/error?__loader=error/page')).toMatchObject({
        body: '{"message":"Unexpected Server Error"}',
      });
      await expectParity('/user/42?__loader=page');
      await expectParity('/deferred?__loader=deferred/page');
    });
  });

  it('runs route actions like the Node data handler', async () => {
    const snapshot = await expectParity('/user/9?__loader=user/(id)/page', {
      method: 'POST',
      body: new URLSearchParams({ name: 'value' }),
    });
    expect(snapshot?.body).toBe('{"id":"9","form":{"name":"value"}}');
    // A route without an action and a method the router does not handle.
    await expectParity('/user/9?__loader=user/(id)/layout', {
      method: 'DELETE',
    });
    await expectParity('/user/9?__loader=user/(id)/page', {
      method: 'PROPFIND',
    });
    await expectParity('/user/9?__loader=user/(id)/page', { method: 'HEAD' });
  });

  it('resolves canonical loader IDs to localized routes like the Node server', async () => {
    expect(
      await expectParity(
        '/cs/hledat?q=traktor&__loader=search',
        undefined,
        canonicalLocalisedRoutes,
      ),
    ).toMatchObject({ body: '{"lang":"cs","q":"traktor"}\n\n' });
    await expectParity(
      '/en/search?__loader=search',
      undefined,
      canonicalLocalisedRoutes,
    );
    await expectParity(
      '/cs/hledat?__loader=layout',
      undefined,
      canonicalLocalisedRoutes,
    );
    await expectParity(
      '/cs/hledat?__loader=missing',
      undefined,
      canonicalLocalisedRoutes,
    );
    expect(
      await expectParity(
        '/cs/o-mne?__loader=about',
        undefined,
        physicalLocalisedRoutes,
      ),
    ).toMatchObject({ body: '{"lang":"cs","page":"o-mne"}\n\n' });
    await expectParity(
      '/en/about?__loader=about',
      undefined,
      physicalLocalisedRoutes,
    );
  });

  it('leaves other requests to page rendering like the Node data handler', async () => {
    for (const url of [
      '/user/42',
      '/user/42?__loader=',
      '/assets/app.js?__loader=page',
    ]) {
      expect(await run('node', routes, url)).toBeUndefined();
      expect(await run('worker', routes, url)).toBeUndefined();
    }
    // `.html` paths are page URLs.
    await expectParity('/user/42.html?__loader=user/(id)/layout');
    const handler = createRouteDataRequestHandler(routes);
    expect(
      await handler({
        request: new Request('https://example.test/other?__loader=page'),
        serverRoutes: [
          { urlPath: '/app', entryName: 'app', entryPath: 'app.html' },
        ],
      }),
    ).toBeUndefined();
  });
});
