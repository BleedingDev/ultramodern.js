import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DeferredData } from '@modern-js/runtime-utils/browser';
import type { NestedRoute } from '@modern-js/types';
import {
  createActionRequest,
  createRequest,
} from '../../../packages/cli/plugin-data-loader/src/cli/createRequest';
import { parseDeferredReadableStream } from '../../../packages/cli/plugin-data-loader/src/cli/data';
import {
  handleRequest,
  setLoaderRouteIdResolver,
} from '../../../packages/cli/plugin-data-loader/src/runtime';
import { createDeferredReadableStream } from '../../../packages/cli/plugin-data-loader/src/runtime/response';

type DispatchOptions = {
  routeId?: string;
  pathname?: string;
  method?: string;
  body?: string;
  headers?: HeadersInit;
  signal?: AbortSignal;
  context?: Map<string, unknown>;
};

async function dispatch(routes: NestedRoute[], options: DispatchOptions = {}) {
  const url = new URL(
    options.pathname ?? '/base/item/a%2Fb',
    'https://golden.test',
  );
  url.searchParams.set('__loader', options.routeId ?? 'item');
  return handleRequest({
    request: new Request(url, {
      method: options.method,
      body: options.body,
      headers: options.headers,
      signal: options.signal,
    }),
    routes,
    serverRoutes: [
      {
        urlPath: '/base',
        entryName: 'main',
        entryPath: 'index.html',
        isSSR: true,
      },
    ],
    context: {
      loaderContext: options.context ?? new Map(),
      reporter: {},
      monitors: { timing() {} },
    } as Parameters<typeof handleRequest>[0]['context'],
  });
}

function item(handlers: Pick<NestedRoute, 'loader' | 'action'>): NestedRoute[] {
  return [{ type: 'nested', id: 'item', path: 'item/:id', ...handlers }];
}

describe.sequential('current React server-only data HTTP contract', () => {
  test('preserves a returned Response status, body, repeated cookies and cache policy', async () => {
    const headers = new Headers({
      'content-type': 'application/json',
      'cache-control': 'private, no-store',
    });
    headers.append('set-cookie', 'first=1; Path=/; HttpOnly');
    headers.append('set-cookie', 'second=2; Path=/; SameSite=Lax');
    const response = await dispatch(
      item({
        loader: () => new Response('{"ok":true}', { status: 201, headers }),
      }),
    );
    expect(response?.status).toBe(201);
    expect(response?.headers.get('x-modernjs-response')).toBe('yes');
    expect(response?.headers.get('cache-control')).toBe('private, no-store');
    expect(response?.headers.getSetCookie()).toEqual([
      'first=1; Path=/; HttpOnly',
      'second=2; Path=/; SameSite=Lax',
    ]);
    expect(await response?.json()).toEqual({ ok: true });
  });

  test.each([
    301, 302, 303, 307, 308,
  ])('encodes returned and thrown %i redirects before browser dispatch', async status => {
    for (const mode of ['returned', 'thrown']) {
      const routes = item({
        loader: () => {
          const response = new Response(null, {
            status,
            headers: { location: '/next', 'set-cookie': 'auth=1; Path=/' },
          });
          if (mode === 'thrown') throw response;
          return response;
        },
      });
      const response = await dispatch(routes);
      expect(response?.status).toBe(204);
      expect(response?.headers.get('x-modernjs-redirect')).toBe('/next');
      expect(response?.headers.has('location')).toBe(false);
      expect(response?.headers.get('set-cookie')).toBe('auth=1; Path=/');
      expect(await response?.text()).toBe('');
    }
  });

  test('distinguishes returned non-2xx data from a thrown catch response', async () => {
    const returned = await dispatch(
      item({ loader: () => Response.json({ invalid: true }, { status: 422 }) }),
    );
    const thrown = await dispatch(
      item({
        loader: () => {
          throw Response.json({ invalid: true }, { status: 422 });
        },
      }),
    );
    expect(returned?.status).toBe(422);
    expect(returned?.headers.get('x-modernjs-response')).toBe('yes');
    expect(returned?.headers.has('x-modernjs-catch')).toBe(false);
    expect(thrown?.status).toBe(422);
    expect(thrown?.headers.get('x-modernjs-catch')).toBe('yes');
    expect(await thrown?.json()).toEqual({ invalid: true });
  });

  test('redacts production thrown errors but preserves the HTTP error marker', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const response = await dispatch(
        item({
          loader: () => {
            throw new Error('request secret');
          },
        }),
      );
      expect(response?.status).toBe(500);
      expect(response?.headers.get('x-modernjs-error')).toBe('yes');
      expect(await response?.json()).toEqual({
        message: 'Unexpected Server Error',
      });
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  test('POST dispatch selects the action and passes encoded params, body and request-owned context', async () => {
    const context = new Map<string, unknown>([['tenant', 'one']]);
    let loaderCalls = 0;
    const response = await dispatch(
      item({
        loader: () => {
          loaderCalls++;
          return null;
        },
        action: async ({ request, params, context: requestContext }) =>
          Response.json(
            {
              params,
              body: await request.text(),
              tenant: (requestContext as { get(key: string): unknown }).get(
                'tenant',
              ),
            },
            { status: 202 },
          ),
      }),
      {
        method: 'POST',
        body: 'quantity=2',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        context,
      },
    );
    expect(loaderCalls).toBe(0);
    expect(response?.status).toBe(202);
    expect(await response?.json()).toEqual({
      params: { id: 'a/b' },
      body: 'quantity=2',
      tenant: 'one',
    });
  });

  test('localized route aliases remain subject to path authorization and request isolation', async () => {
    const routes = [
      ...item({ loader: () => Response.json({ allowed: true }) }),
      {
        type: 'nested' as const,
        id: 'other',
        path: 'other',
        loader: () => null,
      },
    ];
    const first = new Map<string, unknown>();
    const second = new Map<string, unknown>();
    setLoaderRouteIdResolver(first, () => 'item');
    setLoaderRouteIdResolver(second, () => 'other');
    const responses = await Promise.all([
      dispatch(routes, { routeId: 'locale:item', context: first }),
      dispatch(routes, { routeId: 'locale:item', context: second }),
      dispatch(routes, { routeId: 'locale:item' }),
    ]);
    expect(responses.map(response => response?.status)).toEqual([
      200, 403, 403,
    ]);
  });

  test('rejects route-ID access to another path and leaves asset requests to their owner', async () => {
    const routes = [
      ...item({ loader: () => Response.json({ allowed: true }) }),
      {
        type: 'nested' as const,
        id: 'other',
        path: 'other',
        loader: () => null,
      },
    ];
    expect((await dispatch(routes, { pathname: '/base/other' }))?.status).toBe(
      403,
    );
    expect(
      (await dispatch(routes, { pathname: '/base/missing' }))?.status,
    ).toBe(404);
    expect(
      await dispatch(routes, { pathname: '/base/item.js' }),
    ).toBeUndefined();
  });
});

describe('current deferred wire framing', () => {
  test('round trips critical data and deferred values through the real encoder and decoder', async () => {
    let resolve!: (value: string) => void;
    const later = new Promise<string>(done => {
      resolve = done;
    });
    const source = new DeferredData({ critical: 'ready', later });
    const body = createDeferredReadableStream(
      source,
      new AbortController().signal,
    );
    const decoded = await parseDeferredReadableStream(body);
    expect(decoded.data.critical).toBe('ready');
    resolve('done:with:colons');
    await expect(decoded.data.later).resolves.toBe('done:with:colons');
  });

  test('abort closes unresolved deferred values with the current documented rejection', async () => {
    const abort = new AbortController();
    const source = new DeferredData({ later: new Promise(() => {}) });
    const notifications: boolean[] = [];
    const unsubscribe = source.subscribe(aborted =>
      notifications.push(aborted),
    );
    const decoded = await parseDeferredReadableStream(
      createDeferredReadableStream(source, abort.signal),
    );
    const rejection = expect(decoded.data.later).rejects.toThrow(
      'will never resolved',
    );
    abort.abort();
    await rejection;
    expect(notifications).toContain(true);
    unsubscribe();
  });
});

describe('browser request helpers over a real HTTP boundary', () => {
  test('preserves query selectors and abort signal, and keeps action non-2xx Responses raw', async () => {
    const observed: {
      url: string;
      method: string;
      body: string;
      contentType?: string;
    }[] = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      observed.push({
        url: request.url!,
        method: request.method!,
        body: Buffer.concat(chunks).toString(),
        contentType: request.headers['content-type'],
      });
      const outcome = await handleRequest({
        request: new Request(`http://golden.test${request.url}`, {
          method: request.method,
          headers: { 'content-type': request.headers['content-type'] ?? '' },
          body:
            request.method === 'GET'
              ? undefined
              : Buffer.concat(chunks).toString(),
        }),
        routes: [
          {
            type: 'nested',
            id: 'locale:item',
            path: 'item',
            loader: () => Response.json({ result: 'wire' }),
            action: () => Response.json({ result: 'wire' }, { status: 422 }),
          },
        ],
        serverRoutes: [
          {
            urlPath: '/',
            entryName: 'main',
            entryPath: 'index.html',
            isSSR: true,
          },
        ],
        context: {
          loaderContext: new Map(),
          reporter: {},
          monitors: { timing() {} },
        } as Parameters<typeof handleRequest>[0]['context'],
      });
      if (!outcome)
        throw new Error('The source data handler did not own this request');
      response.statusCode = outcome.status;
      for (const [key, value] of outcome.headers)
        response.setHeader(key, value);
      response.end(await outcome.text());
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const result = await createRequest('locale:item')({
        params: {},
        request: new Request(`${origin}/item?sort=price`),
      });
      expect(await (result as Response).json()).toEqual({ result: 'wire' });
      const action = createActionRequest('locale:item')({
        params: {},
        request: new Request(`${origin}/item`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{"amount":2}',
        }),
      });
      const thrown = await action.then(
        () => undefined,
        error => error,
      );
      expect(thrown).toBeInstanceOf(Response);
      expect(thrown.status).toBe(422);
      expect(await thrown.json()).toEqual({ result: 'wire' });
      expect(observed).toEqual([
        {
          url: '/item?sort=price&__loader=locale%3Aitem&__ssrDirect=true',
          method: 'GET',
          body: '',
          contentType: undefined,
        },
        {
          url: '/item?__loader=locale%3Aitem&__ssrDirect=true',
          method: 'POST',
          body: '{"amount":2}',
          contentType: 'application/json',
        },
      ]);
      const aborted = new AbortController();
      aborted.abort();
      await expect(
        createRequest('item')({
          params: {},
          request: new Request(`${origin}/item`, { signal: aborted.signal }),
        }),
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(observed).toHaveLength(2);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve())),
      );
    }
  });
});
