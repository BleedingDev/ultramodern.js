import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import {
  createServerBase,
  type ServerEnv,
  type ServerPlugin,
} from '@modern-js/server-core';
import type { ServerRoute } from '@modern-js/types';
import { MAIN_ENTRY_NAME } from '@modern-js/utils/universal/constants';
import { afterEach, describe, expect, it } from '@rstest/core';
import { RENDERER_BUILD_MANIFEST_FILE } from '../../src/native-composition/native-build-manifest';
import reactBuildMetadataServerPlugin, {
  REACT_RENDERER_IDENTITY_HEADER,
  type ReactBuildMetadataServerOptions,
} from '../../src/native-composition/react-build-metadata-server';

function identity(entryName = 'main'): RendererIdentity {
  return {
    renderer: 'react',
    appId: 'metadata-test-app',
    entryName,
    protocolVersion: 1,
    buildId: 'a'.repeat(64),
  };
}

function route(entryName = 'main', urlPath = '/react'): ServerRoute {
  return {
    entryName,
    urlPath,
    entryPath: `html/${entryName}/index.html`,
    isSSR: false,
  };
}

const activeServers: ReturnType<typeof createServerBase<ServerEnv>>[] = [];

afterEach(async () => {
  await Promise.all(activeServers.splice(0).map(server => server.dispose()));
});

async function metadataServer({
  response = new Response('existing response'),
  renderRoute = route(),
  originalRoute = route(),
  matchPathname,
  matchEntryName,
  routes = [route(), route('other', '/other')],
  entries = { main: identity(), other: identity('other') },
  plugin = reactBuildMetadataServerPlugin({ entries }),
  nativePlugin,
  duplicateMiddleware = false,
}: {
  response?: Response;
  renderRoute?: ServerRoute | null;
  originalRoute?: ServerRoute | null;
  matchPathname?: string;
  matchEntryName?: string;
  routes?: ServerRoute[];
  entries?: ReactBuildMetadataServerOptions['entries'];
  plugin?: ServerPlugin;
  nativePlugin?: ServerPlugin;
  duplicateMiddleware?: boolean;
} = {}) {
  const server = createServerBase<ServerEnv>({
    pwd: '',
    routes,
    appContext: { appDirectory: '', apiDirectory: '', lambdaDirectory: '' },
    config: {
      html: {},
      output: {},
      source: {},
      tools: {},
      server: { logger: false },
      bff: {},
      dev: {},
      security: {},
    },
  });
  activeServers.push(server);
  const responsePlugin: ServerPlugin = {
    name: 'test-react-metadata-response',
    setup(api) {
      api.onPrepare(() => {
        const { middlewares } = api.getServerContext();
        if (duplicateMiddleware) {
          middlewares.push({
            name: 'react-renderer-identity',
            handler: async (_context, next) => next(),
          });
        }
        middlewares.push({
          name: 'render',
          handler(context) {
            if (originalRoute?.entryName) {
              context.set('route', {
                entryName: originalRoute.entryName,
                urlPath: originalRoute.urlPath,
              });
            }
            if (matchPathname !== undefined)
              context.set('matchPathname', matchPathname);
            if (matchEntryName !== undefined)
              context.set('matchEntryName', matchEntryName);
            // This fixture exposes the renderer-owned final match. Actual React
            // dispatch and rewrite matching are covered by the core tests.
            context.set('renderRoute', renderRoute ?? undefined);
            return response;
          },
        });
      });
    },
  };
  server.addPlugins([
    ...(nativePlugin ? [nativePlugin] : []),
    responsePlugin,
    plugin,
  ]);
  await server.init();
  return server;
}

describe('React server build metadata', () => {
  it('serves native assets and APIs while document identity is pending', async () => {
    let finish!: (entries: Record<string, RendererIdentity>) => void;
    const ready = new Promise<Record<string, RendererIdentity>>(resolve => {
      finish = resolve;
    });
    let observeRead!: () => void;
    const reading = new Promise<void>(resolve => {
      observeRead = resolve;
    });
    let reads = 0;
    const server = await metadataServer({
      plugin: reactBuildMetadataServerPlugin({
        manifestFile: RENDERER_BUILD_MANIFEST_FILE,
        resolveEntries: () => {
          reads++;
          observeRead();
          return ready;
        },
      }),
      nativePlugin: {
        name: 'test-native-assets-and-api',
        setup(api) {
          api.onPrepare(() => {
            const { middlewares } = api.getServerContext();
            middlewares.push({
              name: 'rsbuild-dev',
              handler(context, next) {
                if (context.req.path === '/mf-manifest.json')
                  return context.json({ name: 'native-remote' });
                if (context.req.path === '/main.js')
                  return context.body('native script', 200, {
                    'content-type': 'text/javascript',
                  });
                return next();
              },
            });
            middlewares.push({
              name: 'effect-api-handler',
              path: '/api/*',
              order: 'post',
              before: ['render'],
              handler: context => context.json({ result: 'native-api' }),
            });
          });
        },
      },
    });
    let delivered = false;
    const document = server.request('/react/result').then(response => {
      delivered = true;
      return response;
    });
    await reading;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const responses = await Promise.race([
        Promise.all([
          server.request('/mf-manifest.json'),
          server.request('/main.js'),
          server.request('/api/result'),
        ]),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error('Native requests waited for document identity')),
            1000,
          );
        }),
      ]);
      expect(await responses[0].json()).toEqual({ name: 'native-remote' });
      expect(await responses[1].text()).toBe('native script');
      expect(await responses[2].json()).toEqual({ result: 'native-api' });
      for (const response of responses)
        expect(response.headers.has(REACT_RENDERER_IDENTITY_HEADER)).toBe(
          false,
        );
      expect(reads).toBe(1);
      expect(delivered).toBe(false);
    } finally {
      clearTimeout(timer);
      finish({ main: identity(), other: identity('other') });
    }
    const response = await document;
    expect(await response.text()).toBe('existing response');
    expect(
      JSON.parse(response.headers.get(REACT_RENDERER_IDENTITY_HEADER)!),
    ).toEqual(identity());
  });

  it('does not await compilation during setup and waits before rendering when an owning generation is pending', async () => {
    let finish!: (entries: Record<string, RendererIdentity>) => void;
    const ready = new Promise<Record<string, RendererIdentity>>(resolve => {
      finish = resolve;
    });
    let reads = 0;
    const server = await metadataServer({
      plugin: reactBuildMetadataServerPlugin({
        manifestFile: RENDERER_BUILD_MANIFEST_FILE,
        resolveEntries: () => {
          reads++;
          return ready;
        },
      }),
    });
    expect(reads).toBe(0);
    const pending = server.request('/react/result');
    finish({ main: identity(), other: identity('other') });
    const delivered = await pending;
    expect(reads).toBe(1);
    expect(
      JSON.parse(delivered.headers.get(REACT_RENDERER_IDENTITY_HEADER)!),
    ).toEqual(identity());
    expect(await delivered.text()).toBe('existing response');
  });

  it('reads the current owning generation instead of retaining an earlier entry map', async () => {
    let entries = { main: identity(), other: identity('other') };
    const server = await metadataServer({
      plugin: reactBuildMetadataServerPlugin({
        manifestFile: RENDERER_BUILD_MANIFEST_FILE,
        resolveEntries: async () => entries,
      }),
    });
    const first = await server.request('/react/result');
    expect(
      JSON.parse(first.headers.get(REACT_RENDERER_IDENTITY_HEADER)!).buildId,
    ).toBe('a'.repeat(64));
    entries = {
      main: { ...identity(), buildId: 'b'.repeat(64) },
      other: identity('other'),
    };
    const second = await server.request('/react/result');
    expect(
      JSON.parse(second.headers.get(REACT_RENDERER_IDENTITY_HEADER)!).buildId,
    ).toBe('b'.repeat(64));
  });

  it.each([
    ['SSR document', 200, 'text/html; charset=UTF-8', 'server', undefined],
    ['CSR document', 200, 'text/html; charset=UTF-8', 'client', undefined],
    ['not found', 404, 'text/html; charset=UTF-8', 'server', undefined],
    ['redirect', 302, 'text/html; charset=UTF-8', 'server', '/other'],
    ['React loader data', 200, 'application/json', 'server', undefined],
    ['React action payload', 200, 'text/x-component', 'server', undefined],
  ] as const)('adds identity while preserving an existing %s response', async (_name, status, contentType, renderMode, location) => {
    const text = 'original response bytes';
    const headers = new Headers({
      'content-type': contentType,
      'x-modernjs-render': renderMode,
      'cache-control': 'private, no-store',
      vary: 'Cookie',
    });
    headers.append('set-cookie', 'session=one; Path=/; HttpOnly');
    headers.append('set-cookie', 'csrf=two; Path=/');
    if (location) headers.set('location', location);
    const original = new Response(text, { status, headers });
    const expectedCookies = original.headers.getSetCookie();
    const server = await metadataServer({ response: original });

    const delivered = await server.request('/react/result');

    expect(delivered.status).toBe(status);
    expect(delivered.statusText).toBe(original.statusText);
    expect(delivered.body).toBe(original.body);
    expect(delivered.headers.get('content-type')).toBe(contentType);
    expect(delivered.headers.get('x-modernjs-render')).toBe(renderMode);
    expect(delivered.headers.get('cache-control')).toBe('private, no-store');
    expect(delivered.headers.get('vary')).toBe('Cookie');
    expect(delivered.headers.get('location')).toBe(location ?? null);
    expect(delivered.headers.getSetCookie()).toEqual(expectedCookies);
    expect(
      JSON.parse(delivered.headers.get(REACT_RENDERER_IDENTITY_HEADER)!),
    ).toEqual(identity());
    expect(await delivered.text()).toBe(text);
  });

  it('preserves a native redirect response with immutable headers', async () => {
    const location = 'https://redirect.invalid/destination';
    const original = Response.redirect(location, 307);
    const server = await metadataServer({ response: original });

    const response = await server.request('/react/redirect');

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(location);
    expect(response.body).toBeNull();
    expect(
      JSON.parse(response.headers.get(REACT_RENDERER_IDENTITY_HEADER)!),
    ).toEqual(identity());
  });

  it('preserves a fetched data response with immutable headers and the same body', async () => {
    const original = await fetch('data:application/json,%7B%22data%22%3A1%7D');
    const body = original.body;
    const server = await metadataServer({ response: original });

    const response = await server.request('/react/data');

    expect(response.status).toBe(200);
    expect(response.body).toBe(body);
    expect(response.bodyUsed).toBe(false);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.has(REACT_RENDERER_IDENTITY_HEADER)).toBe(true);
    expect(await response.text()).toBe('{"data":1}');
  });

  it('uses the final entry despite an original prefix and rewrite inputs', async () => {
    const server = await metadataServer({
      originalRoute: route(),
      renderRoute: route('other', '/other'),
      matchPathname: '/other/rewritten',
      matchEntryName: 'main',
    });

    const response = await server.request('/react/original');

    expect(
      JSON.parse(response.headers.get(REACT_RENDERER_IDENTITY_HEADER)!),
    ).toEqual(identity('other'));
  });

  it.each([
    undefined,
    '',
  ])('uses the existing main entry fallback for an actual route with entryName %s', async entryName => {
    const finalRoute = { ...route(), entryName };
    if (entryName === undefined) delete finalRoute.entryName;
    const server = await metadataServer({
      renderRoute: finalRoute,
      routes: [finalRoute],
      entries: { [MAIN_ENTRY_NAME]: identity(MAIN_ENTRY_NAME) },
    });

    const response = await server.request('/react/result');

    expect(
      JSON.parse(response.headers.get(REACT_RENDERER_IDENTITY_HEADER)!),
    ).toEqual(identity(MAIN_ENTRY_NAME));
  });

  it.each([
    undefined,
    '',
  ])('omits identity when an actual route with entryName %s has no main entry identity', async entryName => {
    const finalRoute = { ...route(), entryName };
    if (entryName === undefined) delete finalRoute.entryName;
    const server = await metadataServer({
      renderRoute: finalRoute,
      routes: [finalRoute],
      entries: { other: identity('other') },
    });

    const response = await server.request('/react/result');

    expect(response.headers.has(REACT_RENDERER_IDENTITY_HEADER)).toBe(false);
    expect(await response.text()).toBe('existing response');
  });

  it.each([
    [
      'an original route without a final match',
      route(),
      null,
      undefined,
      undefined,
    ],
    ['no route', null, null, undefined, undefined],
    ['an unknown final entry', route(), route('unknown'), undefined, undefined],
    [
      'a pathname rewrite without a final match',
      route(),
      null,
      '/other',
      undefined,
    ],
    [
      'an entry rewrite without a final match',
      route(),
      null,
      undefined,
      'other',
    ],
    ['both rewrites without a final match', route(), null, '/other', 'other'],
  ] as const)('does not stamp %s', async (_name, originalRoute, renderRoute, matchPathname, matchEntryName) => {
    const server = await metadataServer({
      originalRoute,
      renderRoute,
      matchPathname,
      matchEntryName,
    });

    const response = await server.request('/react/original');

    expect(response.headers.has(REACT_RENDERER_IDENTITY_HEADER)).toBe(false);
    expect(await response.text()).toBe('existing response');
  });

  it('does not read or replace a streaming response before delivery', async () => {
    const chunks = ['first chunk\n', 'second chunk\n'];
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          const chunk = chunks[pulls++];
          if (chunk === undefined) controller.close();
          else controller.enqueue(new TextEncoder().encode(chunk));
        },
      },
      { highWaterMark: 0 },
    );
    const original = new Response(body, {
      headers: { 'content-type': 'text/x-component' },
    });
    const server = await metadataServer({ response: original });

    const response = await server.request('/react/stream');

    expect(pulls).toBe(0);
    expect(response.body).toBe(original.body);
    expect(response.headers.get('content-type')).toBe('text/x-component');
    expect(response.headers.has(REACT_RENDERER_IDENTITY_HEADER)).toBe(true);
    expect(await response.text()).toBe(chunks.join(''));
    expect(pulls).toBe(3);
  });

  it('passes cancellation to the same untouched body exactly once', async () => {
    const cancellations: unknown[] = [];
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull() {
          pulls += 1;
        },
        cancel(reason) {
          cancellations.push(reason);
        },
      },
      { highWaterMark: 0 },
    );
    const original = new Response(body);
    const server = await metadataServer({ response: original });
    const response = await server.request('/react/stream');
    const reason = new Error('consumer cancelled');

    expect(response.body).toBe(original.body);
    await response.body!.cancel(reason);

    expect(pulls).toBe(0);
    expect(cancellations).toEqual([reason]);
  });

  it('snapshots only the five identity fields before callers can mutate inputs', async () => {
    const supplied = Object.assign(identity(), {
      privateValue: 'do not expose',
    });
    const entries = { main: supplied };
    const plugin = reactBuildMetadataServerPlugin({ entries });
    supplied.appId = 'mutated-app';
    supplied.buildId = 'b'.repeat(64);
    entries.main = Object.assign(identity(), { privateValue: 'replacement' });
    const server = await metadataServer({ plugin, routes: [route()] });

    const response = await server.request('/react/result');

    expect(
      JSON.parse(response.headers.get(REACT_RENDERER_IDENTITY_HEADER)!),
    ).toEqual(identity());
  });

  it('preserves Unicode entry identities in an ASCII JSON header', async () => {
    const entryName = '入口😀';
    const supplied = { ...identity(entryName), appId: '应用😀' };
    const finalRoute = route(entryName);
    const server = await metadataServer({
      entries: { [entryName]: supplied },
      routes: [finalRoute],
      originalRoute: finalRoute,
      renderRoute: finalRoute,
    });

    const response = await server.request('/react/result');
    const header = response.headers.get(REACT_RENDERER_IDENTITY_HEADER);

    expect(response.status).toBe(200);
    expect(header).toMatch(/^[\u0020-\u007e]+$/u);
    expect(JSON.parse(header!)).toEqual(supplied);
    expect(await response.text()).toBe('existing response');
  });

  it.each([
    ['missing entries', {}],
    ['empty entries', { entries: {} }],
    ['an entries array', { entries: [] }],
    ['a null identity', { entries: { main: null } }],
    ['an empty appId', { entries: { main: { ...identity(), appId: '' } } }],
    [
      'an empty entryName',
      { entries: { main: { ...identity(), entryName: '' } } },
    ],
    ['an empty buildId', { entries: { main: { ...identity(), buildId: '' } } }],
    [
      'an invalid buildId',
      { entries: { main: { ...identity(), buildId: 'release' } } },
    ],
    [
      'another renderer',
      { entries: { main: { ...identity(), renderer: 'solid' } } },
    ],
    ['another entry name', { entries: { main: identity('other') } }],
    [
      'another protocol',
      { entries: { main: { ...identity(), protocolVersion: 2 } } },
    ],
  ])('rejects %s before registering server middleware', (_name, options) => {
    expect(() =>
      reactBuildMetadataServerPlugin(
        options as unknown as ReactBuildMetadataServerOptions,
      ),
    ).toThrow();
  });

  it('rejects an unknown configured UI entry during server preparation', async () => {
    await expect(
      metadataServer({ routes: [route('unknown')] }),
    ).rejects.toThrow(
      'React server route has no renderer identity for unknown',
    );
  });

  it('allows an API route without requiring or emitting a UI identity', async () => {
    const apiRoute = { ...route('api-only', '/api'), isApi: true };
    const server = await metadataServer({
      routes: [route(), apiRoute],
      originalRoute: apiRoute,
      renderRoute: null,
    });

    const response = await server.request('/api/result');

    expect(response.status).toBe(200);
    expect(response.headers.has(REACT_RENDERER_IDENTITY_HEADER)).toBe(false);
  });

  it('rejects an already registered identity middleware', async () => {
    await expect(metadataServer({ duplicateMiddleware: true })).rejects.toThrow(
      'Duplicate React server renderer identity plugin',
    );
  });
});
