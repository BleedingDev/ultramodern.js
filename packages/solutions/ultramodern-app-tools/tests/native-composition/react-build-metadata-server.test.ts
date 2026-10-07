import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  type RendererRouterBindings,
  type RouterPackageBinding,
  validateRendererRouterBindings,
} from '@modern-js/backend-federation-contracts';
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
import {
  resolveCandidateRendererProfile,
  resolveRendererProfile,
} from '../../src/native-composition/renderer-profile';

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
const manifestDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(activeServers.splice(0).map(server => server.dispose()));
  await Promise.all(
    manifestDirectories
      .splice(0)
      .map(directory => fs.rm(directory, { recursive: true, force: true })),
  );
});

async function committedManifest(routerBindings: RendererRouterBindings) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'react-build-metadata-'),
  );
  manifestDirectories.push(directory);
  await fs.writeFile(
    path.join(directory, RENDERER_BUILD_MANIFEST_FILE),
    JSON.stringify({
      schema: 'ultramodern-renderer-build',
      version: 2,
      renderer: 'react',
      profile: resolveRendererProfile('react'),
      entries: { main: identity(), other: identity('other') },
      routerBindings,
      buildId: 'a'.repeat(64),
      sourceRevision: 'workspace',
    }),
  );
  return directory;
}

async function metadataServer({
  pwd = '',
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
  pwd?: string;
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
    pwd,
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
  it.each(['solid', 'octane'] as const)(
    'rejects canonical %s router bindings in late committed metadata',
    async renderer => {
      const provider: RouterPackageBinding = {
        framework: renderer,
        ...resolveCandidateRendererProfile(renderer).router,
      };
      const binding = {
        owner: `@modern-js/renderer-${renderer}`,
        evidence: 'owned-default' as const,
        defaultProvider: provider,
        providers: [provider] as const,
      };
      const routerBindings = { main: binding, other: binding };
      expect(
        validateRendererRouterBindings(routerBindings, ['main', 'other']).ok,
      ).toBe(true);
      await expect(
        metadataServer({
          pwd: await committedManifest(routerBindings),
          plugin: reactBuildMetadataServerPlugin({
            manifestFile: RENDERER_BUILD_MANIFEST_FILE,
          }),
        }),
      ).rejects.toThrow('must be admitted by the selected router owner.');
    },
  );

  it('admits a mixed React router registry in late committed metadata', async () => {
    const reactRouter: RouterPackageBinding = {
      framework: 'react-router',
      ...resolveRendererProfile('react').router,
    };
    const tanstackRouter: RouterPackageBinding = {
      framework: 'tanstack',
      name: '@tanstack/react-router',
      version: '1.171.34',
      coreName: '@tanstack/router-core',
      coreVersion: '1.171.15',
    };
    const binding = {
      owner: '@modern-js/renderer-react',
      evidence: 'provider-registry' as const,
      defaultProvider: reactRouter,
      providers: [reactRouter, tanstackRouter],
    };
    const routerBindings = { main: binding, other: binding };
    expect(
      validateRendererRouterBindings(routerBindings, ['main', 'other']).ok,
    ).toBe(true);
    const server = await metadataServer({
      pwd: await committedManifest(routerBindings),
      plugin: reactBuildMetadataServerPlugin({
        manifestFile: RENDERER_BUILD_MANIFEST_FILE,
      }),
    });

    const response = await server.request('/react/result');

    expect(response.status).toBe(200);
    expect(
      JSON.parse(response.headers.get(REACT_RENDERER_IDENTITY_HEADER)!),
    ).toEqual(identity());
    expect(await response.text()).toBe('existing response');
  });

  it.each([
    ['SSR document', 200, 'text/html; charset=UTF-8', 'server', undefined],
    ['CSR document', 200, 'text/html; charset=UTF-8', 'client', undefined],
    ['not found', 404, 'text/html; charset=UTF-8', 'server', undefined],
    ['redirect', 302, 'text/html; charset=UTF-8', 'server', '/other'],
    ['React loader data', 200, 'application/json', 'server', undefined],
    ['React action payload', 200, 'text/x-component', 'server', undefined],
  ] as const)(
    'adds identity while preserving an existing %s response',
    async (_name, status, contentType, renderMode, location) => {
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
    },
  );

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

  it.each([undefined, ''])(
    'uses the existing main entry fallback for an actual route with entryName %s',
    async entryName => {
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
    },
  );

  it.each([undefined, ''])(
    'omits identity when an actual route with entryName %s has no main entry identity',
    async entryName => {
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
    },
  );

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
  ] as const)(
    'does not stamp %s',
    async (_name, originalRoute, renderRoute, matchPathname, matchEntryName) => {
      const server = await metadataServer({
        originalRoute,
        renderRoute,
        matchPathname,
        matchEntryName,
      });

      const response = await server.request('/react/original');

      expect(response.headers.has(REACT_RENDERER_IDENTITY_HEADER)).toBe(false);
      expect(await response.text()).toBe('existing response');
    },
  );

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
