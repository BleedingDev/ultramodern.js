import type { CacheControl, CacheOption, Container } from '@modern-js/types';
import { createNodeServer } from '../../src/adapters/node/node';
import { getCacheResult } from '../../src/plugins/render/ssrCache';
import {
  type SSRRenderOptions,
  ssrRender,
} from '../../src/plugins/render/ssrRender';

const cacheControl: CacheControl = {
  maxAge: 1000,
  staleWhileRevalidate: 1000,
};

function createContainer(): Container {
  const values = new Map<string, string>();
  return {
    get: async key => values.get(key),
    set: async function (key, value) {
      values.set(key, value);
      return this;
    },
    has: async key => values.has(key),
    delete: async key => values.delete(key),
  };
}

function renderWith(
  requestHandler: (request: Request) => Promise<Response>,
  container = createContainer(),
) {
  return (request: Request, control = cacheControl) =>
    getCacheResult(request, {
      cacheControl: control,
      container,
      requestHandler,
      requestHandlerOptions: {} as any,
    });
}

describe('SSR cache privacy', () => {
  it.each([
    { 'cache-control': 'private' },
    { 'cache-control': 'public, No-Store' },
    { 'cache-control': 'no-cache="set-cookie"' },
    { 'set-cookie': 'session=synthetic' },
    { vary: 'Accept-Language' },
    { vary: '*' },
  ])('does not store responses with %j', async headers => {
    let renders = 0;
    const render = renderWith(
      async () => new Response(`render-${++renders}`, { headers }),
    );
    const request = new Request('http://localhost/private');
    expect(await (await render(request)).text()).toBe('render-1');
    expect(await (await render(request)).text()).toBe('render-2');
  });

  it('partitions public responses by origin and query and preserves cache headers', async () => {
    let renders = 0;
    const render = renderWith(async request => {
      renders++;
      return new Response(request.url, {
        headers: {
          'cache-control': 'public, max-age=1',
          'content-language': 'en',
        },
      });
    });
    for (const url of [
      'http://one.example/page?a=1',
      'http://one.example/page?a=2',
      'http://two.example/page?a=1',
    ]) {
      expect(await (await render(new Request(url))).text()).toBe(url);
      const hit = await render(new Request(url));
      expect(await hit.text()).toBe(url);
      expect(hit.headers.get('cache-control')).toBe('public, max-age=1');
      expect(hit.headers.get('content-language')).toBe('en');
    }
    expect(renders).toBe(3);
  });

  it.each([
    { headers: { cookie: 'session=synthetic' } },
    { headers: { authorization: 'Bearer synthetic' } },
    { headers: { 'cache-control': 'no-cache' } },
    { headers: { 'cache-control': 'no-store' } },
    { method: 'POST', body: 'synthetic' },
  ])('bypasses warm public entries before rendering %j', async init => {
    let renders = 0;
    const render = renderWith(async () => new Response(`render-${++renders}`));
    const url = 'http://localhost/page';
    expect(await (await render(new Request(url))).text()).toBe('render-1');
    expect(await (await render(new Request(url, init))).text()).toBe(
      'render-2',
    );
    expect(await (await render(new Request(url, init))).text()).toBe(
      'render-3',
    );
    expect(await (await render(new Request(url))).text()).toBe('render-1');
  });

  it.each([
    302, 401, 403,
  ])('does not replay status %i as a cached 200', async status => {
    let renders = 0;
    const render = renderWith(
      async () => new Response(`render-${++renders}`, { status }),
    );
    const request = new Request('http://localhost/status');
    for (let count = 1; count <= 2; count++) {
      const response = await render(request);
      expect(response.status).toBe(status);
      expect(await response.text()).toBe(`render-${count}`);
    }
  });

  it('evicts public content when stale refresh becomes private', async () => {
    const container = createContainer();
    const deleted = Promise.withResolvers<void>();
    const remove = container.delete;
    container.delete = async key => {
      const result = await remove(key);
      deleted.resolve();
      return result;
    };
    let now = 10000;
    const clock = rs.spyOn(Date, 'now').mockImplementation(() => now);
    let renders = 0;
    const render = renderWith(async () => {
      renders++;
      return new Response(renders === 1 ? 'public' : 'private', {
        headers: renders === 1 ? {} : { 'cache-control': 'private' },
      });
    }, container);
    const request = new Request('http://localhost/transition');
    try {
      expect(await (await render(request)).text()).toBe('public');
      now += 1001;
      expect(await (await render(request)).text()).toBe('public');
      await deleted.promise;
      expect(await (await render(request)).text()).toBe('private');
      expect(await (await render(request)).text()).toBe('private');
      expect(renders).toBe(4);
    } finally {
      clock.mockRestore();
    }
  });

  it('does not consume entries written under the old unchecked key', async () => {
    const container = createContainer();
    await container.set(
      'explicit-key',
      JSON.stringify({
        val: 'old private response',
        cursor: Date.now(),
      }),
    );
    const render = renderWith(
      async () => new Response('fresh public'),
      container,
    );
    const response = await render(new Request('http://localhost/page'), {
      ...cacheControl,
      customKey: 'explicit-key',
    });
    expect(await response.text()).toBe('fresh public');
  });

  it('uses the Node adapter and SSR provider for public, private, partitioned and bypassed requests', async () => {
    let renders = 0;
    let strategy: CacheOption = cacheControl;
    const container = createContainer();
    const server = await createNodeServer(async (request, context) =>
      ssrRender(request, {
        routeInfo: { entryName: 'main' },
        html: '',
        config: {},
        nodeReq: context?.node?.req,
        serverManifest: {
          renderBundles: {
            main: {
              requestHandler: async (req: Request) => {
                renders++;
                return new Response(req.headers.get('cookie') || 'public');
              },
            },
          },
        },
        cacheConfig: { strategy, container },
        loaderContext: new Map(),
        params: {},
      } as SSRRenderOptions),
    );
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('No address');
      const url = `http://127.0.0.1:${address.port}/page`;
      const read = async (cookie?: string) =>
        (await fetch(url, { headers: cookie ? { cookie } : {} })).text();
      expect(await read()).toBe('public');
      expect(await read()).toBe('public');
      expect(renders).toBe(1);
      expect(await Promise.all([read('user=alice'), read('user=bob')])).toEqual(
        ['user=alice', 'user=bob'],
      );
      expect(renders).toBe(3);
      strategy = req => ({
        ...cacheControl,
        customKey: req.headers.cookie === 'user=alice' ? 'user-a' : 'user-b',
      });
      for (let i = 0; i < 2; i++) {
        expect(await read('user=alice')).toBe('user=alice');
        expect(await read('user=bob')).toBe('user=bob');
      }
      expect(renders).toBe(5);
      strategy = () => false;
      expect(await read('user=alice')).toBe('user=alice');
      expect(await read('user=alice')).toBe('user=alice');
      expect(renders).toBe(7);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve())),
      );
    }
  });
});
