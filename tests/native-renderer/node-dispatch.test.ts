import { once } from 'node:events';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { RendererIdentity } from '../../packages/runtime/renderer-core/src/identity';
import type {
  CachedNativeDocument,
  NativeDocumentCache,
  NativeServerManifest,
} from '../../packages/runtime/renderer-core/src/server/types';
import {
  type Context,
  createServerBase,
  type Next,
  type ServerPlugin,
} from '../../packages/server/core/src';
import { createNodeServer } from '../../packages/server/core/src/adapters/node';
import {
  applyPlugins,
  createProdServer,
} from '../../packages/server/prod-server/src';
import { createDevServer } from '../../packages/server/server/src/createDevServer';
import {
  type AppNormalizedConfig,
  type AppTools,
  appTools,
} from '../../packages/solutions/app-tools/src';
import { getBundleEntry } from '../../packages/solutions/app-tools/src/plugins/analyze/getBundleEntry';
import { nativeRendererInfrastructurePlugin } from '../../packages/solutions/ultramodern-app-tools/src/native-composition/native-infrastructure';
import {
  type NativeNodeBindings,
  nativeServerPlugin,
} from '../../packages/solutions/ultramodern-app-tools/src/native-composition/native-server-plugin';
import {
  type CLIPluginAPI,
  createPluginManager,
} from '../../packages/toolkit/plugin/src';
import {
  createContext,
  initAppContext,
  initPluginAPI,
} from '../../packages/toolkit/plugin/src/cli';

const identity: RendererIdentity = {
  renderer: 'solid',
  appId: 'dispatch-proof',
  entryName: 'main',
  protocolVersion: 1,
  buildId: 'build-a',
};

const roots: string[] = [];
const originalNodeEnv = process.env.NODE_ENV;
afterEach(async () => {
  process.env.NODE_ENV = originalNodeEnv;
  await Promise.all(
    roots.splice(0).map(root => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(manifestIdentity = identity) {
  const root = await mkdtemp(
    path.join(os.tmpdir(), 'ultramodern-native-dispatch-'),
  );
  roots.push(root);
  const dist = path.join(root, 'dist');
  await mkdir(path.join(dist, 'bundles'), { recursive: true });
  await mkdir(path.join(dist, 'static'));
  await mkdir(path.join(dist, 'public'));
  await writeFile(path.join(dist, 'static/asset.txt'), 'static bytes');
  await writeFile(path.join(dist, 'public/public.txt'), 'public bytes');
  await writeFile(
    path.join(dist, 'index.html'),
    '<html>React template must not render</html>',
  );
  const cacheFixture = `module.exports = {
    cacheOption: { maxAge: 60000, staleWhileRevalidate: 0 },
    customContainer: {
      async get() { return JSON.stringify({ val: 'STALE REACT CACHE', cursor: Date.now(), headers: { 'content-type': 'text/html' } }); },
      async set() { throw new Error('Native response reached React cache storage'); },
      async delete() {}
    }
  };`;
  // Dev cache config loads from the source root, production from dist.
  for (const cacheRoot of [root, dist]) {
    await mkdir(path.join(cacheRoot, 'server'));
    await writeFile(path.join(cacheRoot, 'server/cache.js'), cacheFixture);
  }
  await writeFile(
    path.join(dist, 'bundles/main.mjs'),
    `
export const rendererIdentity = ${JSON.stringify(manifestIdentity)};
export const requestHandler = () => { throw new Error('React HTML wrapper was reached'); };
export async function nativeRequestHandler(request, context) {
  const options = { loaderContext: context.session.platform.bindings.loaderContext };
  const pathname = new URL(request.url).pathname;
  if (pathname === '/context') {
    if (!(options.loaderContext instanceof Map)) throw new Error('Missing Node loader context');
    const count = options.loaderContext.get('request-count') || 0;
    options.loaderContext.set('request-count', count + 1);
    return Response.json({ count: count + 1 });
  }
  if (pathname === '/context-preserved') return Response.json({ value: options.loaderContext.get('middleware-value') });
  if (pathname === '/stream') {
    let first = true;
    return new Response(new ReadableStream({
      async pull(controller) {
        if (first) {
          first = false;
          controller.enqueue(new TextEncoder().encode('first native chunk'));
          return;
        }
        const { readFile } = await import('node:fs/promises');
        while (!(await readFile(${JSON.stringify(path.join(root, 'release-stream.txt'))}).catch(() => null))) {
          if (context.session.signal.aborted) return;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        controller.enqueue(new TextEncoder().encode('second native chunk'));
        controller.close();
      }
    }), { status: 206, headers: { 'content-type': 'text/html' } });
  }
  if (pathname === '/cancel') return new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('cancel shell')); },
    async pull() { await new Promise(resolve => setTimeout(resolve, 250)); },
    async cancel() {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(${JSON.stringify(path.join(root, 'cancelled.txt'))}, 'cancelled');
    }
  }), { headers: { 'content-type': 'text/html' } });
  if (pathname === '/data') return new Response(new Uint8Array([0, 255, 10, 13, 128]), {
    status: 201, statusText: 'Native Data', headers: { 'content-type': 'application/x-native-data', 'x-native': 'data' }
  });
  if (pathname === '/redirect') return new Response(null, { status: 307, statusText: 'Native Redirect', headers: { location: '/destination' } });
  if (pathname === '/cookies') {
    const headers = new Headers({ 'content-type': 'application/json' });
    headers.append('set-cookie', 'first=1; Path=/; HttpOnly');
    headers.append('set-cookie', 'second=2; Path=/; SameSite=Lax');
    return new Response('{"ok":true}', { headers });
  }
  if (pathname === '/null-body') return new Response(null, { status: 200, statusText: 'Native Null' });
  if (pathname === '/no-content') return new Response(null, { status: 204, statusText: 'Native Empty', headers: { 'x-native': 'empty' } });
  if (pathname === '/not-modified') return new Response(null, { status: 304, statusText: 'Native Unchanged', headers: { etag: 'native' } });
  if (pathname === '/error') throw new Error('native pre-shell failure');
  if (pathname === '/stream-error') return new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('native shell')); },
    async pull(controller) {
      await new Promise(resolve => setTimeout(resolve, 80));
      controller.error(new Error('native post-shell failure'));
    }
  }), { status: 202, headers: { 'content-type': 'text/html', 'x-native': 'committed' } });
  return new Response('native:' + rendererIdentity.renderer + ':' + rendererIdentity.buildId, {
    status: 202, statusText: 'Native Document', headers: { 'content-type': 'text/html; charset=utf-8', 'x-native': 'document' }
  });
}
`,
  );
  await writeFile(
    path.join(dist, 'bundles/main-server-loaders.js'),
    `
module.exports = { routes: [], handleRequest() { throw new Error('React data matcher was reached'); } };
`,
  );
  return { root, dist };
}

function serverOptions(
  root: string,
  dist: string,
  expectedIdentity = identity,
) {
  const renderer = expectedIdentity.renderer;
  if (renderer === 'react')
    throw new Error('This admission fixture requires a native renderer');
  const plugin = nativeServerPlugin({
    renderer,
    entries: { [expectedIdentity.entryName]: expectedIdentity },
    resolveManifest: (manifest, entry) =>
      manifest.renderBundles?.[
        entry.entryName
      ] as unknown as NativeServerManifest<NativeNodeBindings>,
    onError: () =>
      new Response('selected native fallback', {
        status: 503,
        headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' },
      }),
  });
  const routes: NonNullable<Parameters<typeof createProdServer>[0]['routes']> =
    [
      {
        urlPath: '/',
        entryName: 'main',
        entryPath: 'index.html',
        bundle: 'bundles/main.mjs',
        isSSR: true,
      },
      {
        urlPath: '/public.txt',
        entryPath: 'public/public.txt',
        isSSR: false,
      },
    ];
  return {
    pwd: dist,
    serverConfigPath: path.join(root, 'modern.server.mjs'),
    appContext: { apiDirectory: '', lambdaDirectory: '', appDirectory: root },
    routes,
    config: {
      html: {},
      output: { distPath: { root: 'dist' } },
      source: {},
      tools: {},
      server: { logger: false, ssr: true },
      bff: {},
      dev: {},
      security: {},
    },
    serverConfig: {
      onError: (error: Error) => new Response(error.stack, { status: 500 }),
      renderMiddlewares: [
        {
          name: 'native-null-body-proof',
          async handler(context: Context, next: Next) {
            await next();
            if (context.req.path === '/null-body') {
              context.header(
                'x-native-null-body',
                String(context.res.body === null),
              );
            }
          },
        },
      ],
      middlewares: [
        {
          name: 'configured-loader-context',
          path: '/context-preserved',
          handler: (
            context: { set: (key: string, value: unknown) => void },
            next: () => Promise<void>,
          ) => {
            context.set(
              'loaderContext',
              new Map([['middleware-value', 'preserved']]),
            );
            return next();
          },
        },
        {
          name: 'configured-api',
          path: '/api/ping',
          handler: () => Response.json({ api: true }),
        },
        {
          name: 'configured-response',
          path: '/custom',
          handler: () => new Response('custom bytes', { status: 203 }),
        },
      ],
    },
    plugins: [plugin],
  };
}

async function listen(server: Awaited<ReturnType<typeof createNodeServer>>) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function close(server: Awaited<ReturnType<typeof createNodeServer>>) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close(error => (error ? reject(error) : resolve())),
  );
}

async function authoredServerFixture(renderer: 'solid' | 'octane') {
  const authoredIdentity: RendererIdentity = {
    ...identity,
    renderer,
    appId: 'authored-server-dispatch-proof',
  };
  const { root, dist } = await fixture(authoredIdentity);
  const sourceDirectory = path.join(root, 'src');
  await mkdir(sourceDirectory);
  const sourceEntry = path.join(sourceDirectory, 'index.ts');
  const sourceServerEntry = path.join(sourceDirectory, 'index.server.ts');
  const fixtureServerEntry = path.join(
    import.meta.dirname,
    'fixtures/authored-server-entry/index.server.ts',
  );
  await writeFile(sourceEntry, 'export const authoredClient = true;\n');
  await copyFile(fixtureServerEntry, sourceServerEntry);

  for (const [name, directory] of [
    ['ultramodern-app-tools', '../../packages/solutions/ultramodern-app-tools'],
    ['renderer-core', '../../packages/runtime/renderer-core'],
  ]) {
    const slot = path.join(root, 'node_modules/@modern-js', name);
    await mkdir(path.dirname(slot), { recursive: true });
    await symlink(path.resolve(import.meta.dirname, directory), slot, 'dir');
  }
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'authored-server-dispatch-proof', private: true }),
  );
  const config = {
    renderer,
    source: { entriesDir: './src', mainEntryName: 'main' },
    server: { ssr: true },
    output: { cleanDistPath: false },
  };
  const manager = createPluginManager();
  manager.addPlugins([
    appTools({ rendererExtensions: false, serverExtensions: false }),
    nativeRendererInfrastructurePlugin(renderer, undefined, {
      async resolveBuildIdentities() {
        return {
          identities: { main: authoredIdentity },
          buildMarker: authoredIdentity.buildId,
          sourceRevision: 'authored-server-dispatch-proof',
          inputDigest: 'a'.repeat(64),
          profileDigest: 'b'.repeat(64),
          compilerDigest: 'c'.repeat(64),
          frameworkCohortDigest: 'd'.repeat(64),
          cacheAllowed: false,
          promotable: false,
        };
      },
    }),
  ]);
  const plugins = manager.getPlugins();
  const context = await createContext<AppTools>({
    appContext: initAppContext({
      packageName: 'authored-server-dispatch-proof',
      configFile: false,
      command: 'build',
      appDirectory: root,
      metaName: 'modern-js',
      plugins,
    }),
    config,
    normalizedConfig: config as AppNormalizedConfig,
  });
  const api = initPluginAPI({ context, pluginManager: manager });
  context.pluginAPI = api;
  for (const plugin of plugins) {
    await plugin.setup?.(api as CLIPluginAPI<AppTools>);
  }
  const discovered = await getBundleEntry(
    api.getHooks(),
    api.getAppContext(),
    api.getNormalizedConfig(),
  );
  const { entrypoints } = await api
    .getHooks()
    .modifyEntrypoints.call({ entrypoints: discovered });
  expect(entrypoints).toHaveLength(1);
  expect(entrypoints[0].customEntry).toBe(true);
  expect(entrypoints[0].customServerEntry).toBe(sourceServerEntry);
  api.updateAppContext({
    serverRoutes: [
      { entryName: 'main', entryPath: 'index.html', urlPath: '/', isSSR: true },
    ],
  });
  await api.getHooks().generateEntryCode.call({ entrypoints });
  const generatedServerEntry = path.join(
    path.dirname(entrypoints[0].internalEntry!),
    'index.server.ts',
  );
  const generatedSource = await readFile(generatedServerEntry, 'utf-8');
  expect(generatedSource).toContain(
    `await import(${JSON.stringify(sourceServerEntry)})`,
  );
  expect(generatedSource).toContain(
    'handler.nativeRequestHandler ?? handler.default',
  );
  expect(generatedSource).not.toMatch(
    /(?:from|import\()\s*['"](?:react(?:-dom|-server-dom[^/'"]*)?(?:\/|['"])|@modern-js\/runtime(?:\/|['"]))/u,
  );
  // Execute the owning generator's exact bytes through the real Node loader.
  // The .mjs transport does not rewrite its imports or its authored hand-off.
  const bundle = path.join(dist, 'bundles/main.mjs');
  await copyFile(generatedServerEntry, bundle);
  expect(await readFile(bundle, 'utf-8')).toBe(generatedSource);
  expect(await readFile(sourceServerEntry, 'utf-8')).toBe(
    await readFile(fixtureServerEntry, 'utf-8'),
  );
  return {
    root,
    dist,
    authoredIdentity,
    sourceServerEntry,
    fixtureServerEntry,
  };
}

it.each([
  ['solid', 'production'],
  ['solid', 'development'],
  ['octane', 'production'],
  ['octane', 'development'],
] as const)('rejects RSC before importing an authored %s server entry through the real %s server', async (renderer, mode) => {
  process.env.NODE_ENV = mode;
  const {
    root,
    dist,
    authoredIdentity,
    sourceServerEntry,
    fixtureServerEntry,
  } = await authoredServerFixture(renderer);
  const options = serverOptions(root, dist, authoredIdentity);
  options.serverConfig.middlewares = [];
  const server =
    mode === 'production'
      ? await createProdServer(options)
      : (
          await createDevServer(
            { ...options, pwd: root, dev: {} },
            applyPlugins,
          )
        ).server;
  const origin = await listen(server);
  const imported = path.join(root, 'authored-entry-imported.txt');
  const dispatched = path.join(root, 'authored-entry-dispatches.txt');
  const marker = (file: string) => readFile(file, 'utf-8').catch(() => '');
  try {
    const rejectRsc = async () => {
      for (const [header, method] of [
        ['x-rsc-tree', 'GET'],
        ['x-rsc-action', 'POST'],
      ]) {
        const response = await fetch(`${origin}/authored`, {
          method,
          headers: { [header]: '1' },
        });
        expect(response.status).toBe(400);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect((await response.json()).code).toBe(
          'unsupported-renderer-capability',
        );
      }
    };
    await rejectRsc();
    expect(await marker(imported)).toBe('');
    expect(await marker(dispatched)).toBe('');

    const response = await fetch(`${origin}/authored`);
    expect(response.status).toBe(207);
    expect(response.statusText).toBe('Authored Native Entry');
    expect(response.headers.get('x-authored-entry')).toBe('fetch-handler');
    expect(await response.json()).toEqual({
      authored: true,
      renderer,
      buildId: authoredIdentity.buildId,
      sessionRenderer: renderer,
      entryName: 'main',
      loaderContextIsMap: true,
      method: 'GET',
      pathname: '/authored',
    });
    expect(await marker(imported)).toBe('authored module imported\n');
    expect(await marker(dispatched)).toBe('GET /authored\n');

    await rejectRsc();
    expect(await marker(imported)).toBe('authored module imported\n');
    expect(await marker(dispatched)).toBe('GET /authored\n');
    expect(await readFile(sourceServerEntry, 'utf-8')).toBe(
      await readFile(fixtureServerEntry, 'utf-8'),
    );
  } finally {
    await close(server);
  }
});

it.each([
  'production',
  'development',
] as const)('preserves terminal Fetch outcomes through the real %s server', async mode => {
  process.env.NODE_ENV = mode;
  const { root, dist } = await fixture();
  const options = serverOptions(root, dist);
  options.plugins.push({
    name: 'native-proof-final-order',
    pre: [
      '@modern-js/plugin-inject-resource',
      '@modern-js/plugin-render',
      '@modern-js/native-node-terminal-responses',
    ],
    setup(api) {
      api.onPrepare(() => {
        const names = api
          .getServerContext()
          .middlewares.map(middleware => middleware.name);
        expect(names.indexOf('inject-server-manifest')).toBeLessThan(
          names.indexOf('render'),
        );
        expect(names.indexOf('inject-html')).toBeLessThan(
          names.indexOf('render'),
        );
        expect(names[0]).toBe('native-node-rsc-guard');
      });
    },
  } as ServerPlugin);
  const server =
    mode === 'production'
      ? await createProdServer(options)
      : (
          await createDevServer(
            { ...options, pwd: root, dev: {} },
            applyPlugins,
          )
        ).server;
  const origin = await listen(server);
  try {
    const document = await fetch(`${origin}/`);
    const documentBody = await document.text();
    expect(document.status, documentBody).toBe(202);
    expect(document.statusText).toBe('Native Document');
    expect(documentBody).toBe('native:solid:build-a');
    const contexts = await Promise.all([
      fetch(`${origin}/context`).then(response => response.json()),
      fetch(`${origin}/context`).then(response => response.json()),
    ]);
    expect(contexts).toEqual([{ count: 1 }, { count: 1 }]);
    expect(await (await fetch(`${origin}/context-preserved`)).json()).toEqual({
      value: 'preserved',
    });

    const progressive = await fetch(`${origin}/stream`);
    expect(progressive.status).toBe(206);
    const reader = progressive.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe('first native chunk');
    await writeFile(path.join(root, 'release-stream.txt'), 'release');
    const second = await reader.read();
    expect(new TextDecoder().decode(second.value)).toBe('second native chunk');
    expect((await reader.read()).done).toBe(true);

    const abort = new AbortController();
    const cancellable = await fetch(`${origin}/cancel`, {
      signal: abort.signal,
    });
    expect(
      new TextDecoder().decode(
        (await cancellable.body!.getReader().read()).value,
      ),
    ).toBe('cancel shell');
    abort.abort();
    let cancellation = '';
    for (let retry = 0; retry < 30 && !cancellation; retry++) {
      await new Promise(resolve => setTimeout(resolve, 20));
      cancellation = await readFile(
        path.join(root, 'cancelled.txt'),
        'utf-8',
      ).catch(() => '');
    }
    expect(cancellation).toBe('cancelled');

    const interrupted = await fetch(`${origin}/stream-error`);
    expect(interrupted.status).toBe(202);
    expect(interrupted.headers.get('x-native')).toBe('committed');
    await expect(interrupted.text()).rejects.toThrow();
    const data = await fetch(`${origin}/data`);
    expect(data.status).toBe(201);
    expect(data.statusText).toBe('Native Data');
    expect(data.headers.get('content-type')).toBe('application/x-native-data');
    expect(Array.from(new Uint8Array(await data.arrayBuffer()))).toEqual([
      0, 255, 10, 13, 128,
    ]);

    const redirect = await fetch(`${origin}/redirect`, { redirect: 'manual' });
    expect(redirect.status).toBe(307);
    expect(redirect.statusText).toBe('Native Redirect');
    expect(redirect.headers.get('location')).toBe('/destination');
    expect(await redirect.text()).toBe('');

    const cookies = await fetch(`${origin}/cookies`);
    expect(cookies.headers.getSetCookie()).toEqual([
      'first=1; Path=/; HttpOnly',
      'second=2; Path=/; SameSite=Lax',
    ]);
    expect(cookies.headers.get('content-type')).toBe('application/json');
    expect(await cookies.json()).toEqual({ ok: true });

    const nullBody = await fetch(`${origin}/null-body`);
    expect(nullBody.status).toBe(200);
    expect(nullBody.statusText).toBe('Native Null');
    expect(nullBody.headers.get('x-native-null-body')).toBe('true');
    expect(nullBody.headers.has('content-type')).toBe(false);
    expect(await nullBody.text()).toBe('');
    for (const [pathname, status, statusText] of [
      ['/no-content', 204, 'Native Empty'],
      ['/not-modified', 304, 'Native Unchanged'],
    ] as const) {
      const response = await fetch(`${origin}${pathname}`);
      expect(response.status).toBe(status);
      expect(response.statusText).toBe(statusText);
      expect(response.body).toBeNull();
      expect(await response.text()).toBe('');
    }

    const head = await fetch(`${origin}/`, { method: 'HEAD' });
    expect(head.status).toBe(202);
    expect(head.statusText).toBe('Native Document');
    expect(head.headers.get('x-native')).toBe('document');
    expect(await head.text()).toBe('');

    expect(await (await fetch(`${origin}/static/asset.txt`)).text()).toBe(
      'static bytes',
    );
    expect(await (await fetch(`${origin}/public.txt`)).text()).toBe(
      'public bytes',
    );
    expect(await (await fetch(`${origin}/api/ping`)).json()).toEqual({
      api: true,
    });
    const custom = await fetch(`${origin}/custom`);
    expect(custom.status).toBe(203);
    expect(await custom.text()).toBe('custom bytes');

    const dataRequest = await fetch(`${origin}/data?__loader=route-id`, {
      method: 'POST',
    });
    expect(dataRequest.status).toBe(201);
    expect(dataRequest.headers.get('content-type')).toBe(
      'application/x-native-data',
    );
    expect(Array.from(new Uint8Array(await dataRequest.arrayBuffer()))).toEqual(
      [0, 255, 10, 13, 128],
    );

    for (const pathname of [
      '/',
      '/static/asset.txt',
      '/public.txt',
      '/api/ping',
      '/custom',
    ]) {
      for (const header of ['x-rsc-tree', 'x-rsc-action']) {
        const response = await fetch(`${origin}${pathname}`, {
          headers: { [header]: '1' },
        });
        expect(response.status).toBe(400);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect((await response.json()).code).toBe(
          'unsupported-renderer-capability',
        );
      }
    }
    const fallback = await fetch(`${origin}/error`);
    expect(fallback.status).toBe(503);
    expect(await fallback.text()).toBe('selected native fallback');
  } finally {
    await close(server);
  }
});

it('rejects final modifyConfig RSC before resource warmup', async () => {
  process.env.NODE_ENV = 'production';
  const { root, dist } = await fixture();
  const options = serverOptions(root, dist);
  const warmupMarker = path.join(root, 'warmup.txt');
  await writeFile(
    path.join(dist, 'bundles/main.mjs'),
    `
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(warmupMarker)}, 'warmup ran');
`,
  );
  options.plugins.push({
    name: 'final-rsc-override',
    setup(api) {
      api.modifyConfig(config => ({
        ...config,
        server: { ...config.server, rsc: true },
      }));
    },
  } as ServerPlugin);
  const server = createServerBase(options);
  await applyPlugins(server, options);
  await expect(server.init()).rejects.toThrow(
    'unsupported-renderer-capability',
  );
  await server.dispose();
  expect(await readFile(warmupMarker, 'utf-8').catch(() => '')).toBe('');
});

it('preserves two entry identities and their adjacent render middleware', async () => {
  process.env.NODE_ENV = 'production';
  const { root, dist } = await fixture();
  const options = serverOptions(root, dist);
  const secondIdentity: RendererIdentity = {
    ...identity,
    entryName: 'second',
    buildId: 'second-build',
  };
  const secondBundle = (
    await readFile(path.join(dist, 'bundles/main.mjs'), 'utf-8')
  ).replace(JSON.stringify(identity), JSON.stringify(secondIdentity));
  await writeFile(path.join(dist, 'bundles/second.mjs'), secondBundle);
  Object.assign(options.routes[0], {
    responseHeaders: { 'x-configured-entry': 'main-policy' },
  });
  options.routes.push({
    urlPath: '/second',
    entryName: 'second',
    entryPath: 'index.html',
    bundle: 'bundles/second.mjs',
    isSSR: true,
    responseHeaders: { 'x-configured-entry': 'second-policy' },
  });
  options.plugins = [
    nativeServerPlugin({
      renderer: 'solid',
      entries: { main: identity, second: secondIdentity },
    }),
  ];
  const server = await createProdServer({
    ...options,
    config: {
      ...options.config,
      server: {
        ...options.config.server,
        routes: {
          main: { resHeaders: { 'x-configured-entry': 'main-policy' } },
          second: { resHeaders: { 'x-configured-entry': 'second-policy' } },
        },
      },
    },
    serverConfig: {
      ...options.serverConfig,
      renderMiddlewares: [
        {
          name: 'selected-entry-render-policy',
          handler: (context, next) => {
            context.header('x-render-entry', context.get('route').entryName);
            context.header(
              'set-cookie',
              `entry=${context.get('route').entryName}; Path=/`,
              { append: true },
            );
            return next();
          },
        },
      ],
    },
  });
  const origin = await listen(server);
  try {
    const first = await fetch(`${origin}/`);
    const firstBody = await first.text();
    expect(first.status, firstBody).toBe(202);
    expect(first.headers.get('x-render-entry')).toBe('main');
    expect(first.headers.get('x-configured-entry')).toBe('main-policy');
    expect(first.headers.getSetCookie()).toEqual(['entry=main; Path=/']);
    expect(firstBody).toBe('native:solid:build-a');
    const second = await fetch(`${origin}/second/path`);
    expect(second.headers.get('x-render-entry')).toBe('second');
    expect(second.headers.get('x-configured-entry')).toBe('second-policy');
    expect(second.headers.getSetCookie()).toEqual(['entry=second; Path=/']);
    expect(await second.text()).toBe('native:solid:second-build');
    const cookies = await fetch(`${origin}/cookies`);
    expect(cookies.headers.getSetCookie()).toEqual([
      'entry=main; Path=/',
      'first=1; Path=/; HttpOnly',
      'second=2; Path=/; SameSite=Lax',
    ]);
    expect(cookies.headers.get('content-type')).toBe('application/json');
    expect(await cookies.json()).toEqual({ ok: true });
  } finally {
    await close(server);
  }
});

it('reuses one native document cache at one origin across renderer, app and hydration builds', async () => {
  process.env.NODE_ENV = 'production';
  const values = new Map<string, CachedNativeDocument>();
  let cacheWrites = 0;
  let cacheHits = 0;
  let handlerCalls = 0;
  const cache: NativeDocumentCache = {
    get(key) {
      const value = values.get(key);
      if (value) cacheHits++;
      return value;
    },
    set(key, value) {
      values.set(key, value);
      cacheWrites++;
    },
  };
  let activeRuntime: ReturnType<typeof createServerBase> | undefined;
  const transport = await createNodeServer((request, env) =>
    activeRuntime!.handle(request, env),
  );
  const origin = await listen(transport);
  const expectedIdentities: RendererIdentity[] = [
    identity,
    { ...identity, buildId: 'build-b' },
    { ...identity, renderer: 'octane', buildId: 'build-b' },
    {
      ...identity,
      renderer: 'octane',
      appId: 'another-app',
      buildId: 'build-b',
    },
    {
      ...identity,
      renderer: 'octane',
      appId: 'another-app',
      buildId: 'build-b',
    },
  ];
  try {
    for (const [index, expectedIdentity] of expectedIdentities.entries()) {
      const { root, dist } = await fixture(expectedIdentity);
      const options = serverOptions(root, dist, expectedIdentity);
      const renderer = expectedIdentity.renderer;
      if (renderer === 'react') throw new Error('Native fixture only');
      options.plugins = [
        nativeServerPlugin({
          renderer,
          entries: { main: expectedIdentity },
          cache,
          cacheAllowed: true,
          resolveManifest: manifest => ({
            ...(manifest.renderBundles!
              .main as unknown as NativeServerManifest<NativeNodeBindings>),
            nativeRequestHandler: (_request, context) => {
              handlerCalls++;
              context.session.resolveResponse({
                kind: 'document',
                status: 200,
                statusText: 'Native Cached Document',
                headers: [['content-type', 'text/html; charset=utf-8']],
                cache: { mode: 'public', maxAgeSeconds: 60 },
              });
              return context.session.respond(
                new ReadableStream({
                  start(controller) {
                    controller.enqueue(
                      new TextEncoder().encode(JSON.stringify(context.entry)),
                    );
                    controller.close();
                  },
                }),
              );
            },
          }),
        }),
      ];
      const runtime = createServerBase(options);
      await applyPlugins(runtime, options, transport);
      await runtime.init();
      const previous = activeRuntime;
      activeRuntime = runtime;
      await previous?.dispose();
      const response = await fetch(`${origin}/`);
      expect(response.statusText).toBe('Native Cached Document');
      expect(JSON.parse(await response.text())).toEqual(expectedIdentity);
      const expectedWrites = Math.min(index + 1, 4);
      for (let retry = 0; retry < 30 && cacheWrites < expectedWrites; retry++) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(cacheWrites).toBe(expectedWrites);
    }
    expect(handlerCalls).toBe(4);
    expect(cacheWrites).toBe(4);
    expect(cacheHits).toBe(1);
    expect(values.size).toBe(4);
  } finally {
    await close(transport);
    await activeRuntime?.dispose();
  }
});

it('checks immutable bundle identity before the selected handler and never reaches the React cache', async () => {
  process.env.NODE_ENV = 'production';
  const { root, dist } = await fixture({ ...identity, buildId: 'stale-build' });
  const options = serverOptions(root, dist);
  let handlerCalls = 0;
  let cacheGets = 0;
  let cacheSets = 0;
  const plugin = nativeServerPlugin({
    renderer: 'solid',
    entries: { main: identity },
    cacheAllowed: true,
    cache: {
      get() {
        cacheGets++;
        return undefined;
      },
      set() {
        cacheSets++;
      },
    },
    resolveManifest: manifest => {
      const nativeManifest = manifest.renderBundles!
        .main as unknown as NativeServerManifest<NativeNodeBindings>;
      return {
        ...nativeManifest,
        nativeRequestHandler: async () => {
          handlerCalls++;
          return new Response('unsafe cache hit');
        },
      };
    },
  });
  options.plugins = [plugin];
  const server = await createProdServer(options);
  const origin = await listen(server);
  try {
    const response = await fetch(`${origin}/`);
    expect(response.status).toBe(500);
    expect(handlerCalls).toBe(0);
    expect(cacheGets).toBe(0);
    expect(cacheSets).toBe(0);
    const errorBody = await response.text();
    expect(errorBody).toContain('identity');
    expect(errorBody).not.toContain('unsafe cache hit');
  } finally {
    await close(server);
  }
});

it.each([
  'cookie',
  'private',
  'configured-private',
  'prepared-private',
  'transformed-body',
  'mutated-reason',
  'vary',
  'status',
] as const)('refuses cache writes after configured middleware changes final wire %s', async policy => {
  process.env.NODE_ENV = 'production';
  const { root, dist } = await fixture();
  const options = serverOptions(root, dist);
  let cacheWrites = 0;
  let handlerCalls = 0;
  options.plugins = [
    nativeServerPlugin({
      renderer: 'solid',
      entries: { main: identity },
      cacheAllowed: true,
      cache: {
        get: () => undefined,
        set: () => {
          cacheWrites++;
        },
      },
      resolveManifest: manifest => ({
        ...(manifest.renderBundles!
          .main as unknown as NativeServerManifest<NativeNodeBindings>),
        nativeRequestHandler: (_request, context) => {
          handlerCalls++;
          context.session.resolveResponse({
            kind: 'document',
            status: 200,
            statusText: 'Native Public Document',
            headers: [
              ['content-type', 'text/html'],
              ['cache-control', 'public, max-age=60'],
            ],
            cache: { mode: 'public', maxAgeSeconds: 60 },
          });
          return context.session.respond(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('public document'));
                controller.close();
              },
            }),
          );
        },
      }),
    }),
  ];
  if (policy === 'configured-private')
    Object.assign(options.routes[0], {
      responseHeaders: { 'cache-control': 'private' },
    });
  const server = await createProdServer({
    ...options,
    serverConfig: {
      ...options.serverConfig,
      renderMiddlewares: [
        {
          name: 'late-document-policy',
          async handler(context, next) {
            if (policy === 'prepared-private')
              context.header('cache-control', 'private');
            await next();
            if (policy === 'mutated-reason') {
              const original = context.res;
              context.res = new Response(original.body, {
                status: original.status,
                statusText: 'Middleware Reason',
                headers: original.headers,
              });
              expect(context.res.body).toBe(original.body);
              return;
            }
            // Consumption precedes the final privacy mutation and transport.
            const body = await context.res.text();
            const headers = new Headers(context.res.headers);
            context.res = new Response(
              policy === 'transformed-body' ? `transformed:${body}` : body,
              {
                status: policy === 'status' ? 203 : 200,
                headers,
              },
            );
            if (policy === 'cookie')
              context.header('set-cookie', 'late=1; Path=/', { append: true });
            if (policy === 'private')
              context.header('cache-control', 'private');
            if (policy === 'vary') context.header('vary', 'Accept-Language');
          },
        },
      ],
    },
  });
  const origin = await listen(server);
  try {
    for (let request = 0; request < 2; request++) {
      const response = await fetch(`${origin}/`);
      expect(response.status).toBe(policy === 'status' ? 203 : 200);
      if (policy === 'mutated-reason') {
        expect(response.statusText).toBe('Middleware Reason');
        expect(response.headers.get('cache-control')).toBe(
          'public, max-age=60',
        );
      }
      expect(await response.text()).toBe(
        policy === 'transformed-body'
          ? 'transformed:public document'
          : 'public document',
      );
      if (policy === 'transformed-body')
        expect(response.headers.get('cache-control')).toBe(
          'public, max-age=60',
        );
      if (policy === 'cookie')
        expect(response.headers.getSetCookie()).toEqual(['late=1; Path=/']);
      if (
        policy === 'private' ||
        policy === 'configured-private' ||
        policy === 'prepared-private'
      )
        expect(response.headers.get('cache-control')).toBe('private');
      if (policy === 'vary')
        expect(response.headers.get('vary')).toBe('Accept-Language');
    }
    await new Promise(resolve => setImmediate(resolve));
    expect(handlerCalls).toBe(2);
    expect(cacheWrites).toBe(0);
  } finally {
    await close(server);
  }
});

it.each([
  'route-ids',
  'disabled',
  'entry-disabled',
  'force-csr',
] as const)('uses native document selection for %s without redirecting data or action requests', async policy => {
  process.env.NODE_ENV = 'production';
  const { root, dist } = await fixture();
  const options = serverOptions(root, dist);
  options.plugins = [
    nativeServerPlugin({
      renderer: 'solid',
      entries: { main: identity },
      resolveManifest: manifest => ({
        ...(manifest.renderBundles!
          .main as unknown as NativeServerManifest<NativeNodeBindings>),
        nativeRequestHandler: request =>
          Response.json({ selected: 'ssr', method: request.method }),
        nativeCSRRequestHandler: () => Response.json({ selected: 'csr' }),
        nativeMatchRouteIds: request => [
          'root',
          new URL(request.url).pathname.slice(1),
        ],
      }),
    }),
  ];
  const serverPolicy =
    policy === 'route-ids'
      ? { ssr: true, ssrByRouteIds: ['allowed', 'shell'] }
      : policy === 'disabled'
        ? { ssr: false }
        : policy === 'entry-disabled'
          ? { ssr: true, ssrByEntries: { main: false } }
          : { ssr: { mode: 'stream' as const, forceCSR: true } };
  const server = await createProdServer({
    ...options,
    config: {
      ...options.config,
      server: { ...options.config.server, ...serverPolicy },
    },
  });
  const origin = await listen(server);
  try {
    const selected = policy === 'force-csr' ? '/allowed?csr=1' : '/disabled';
    expect(await (await fetch(`${origin}${selected}`)).json()).toEqual({
      selected: 'csr',
    });
    if (policy === 'route-ids' || policy === 'force-csr') {
      expect(await (await fetch(`${origin}/allowed`)).json()).toEqual({
        selected: 'ssr',
        method: 'GET',
      });
      expect(
        await (
          await fetch(`${origin}/shell`, { headers: { purpose: 'prefetch' } })
        ).json(),
      ).toEqual({ selected: 'ssr', method: 'GET' });
    }
    if (policy === 'force-csr') {
      expect(
        await (
          await fetch(`${origin}/allowed`, {
            headers: { 'x-modern-ssr-fallback': '1' },
          })
        ).json(),
      ).toEqual({ selected: 'csr' });
      expect(await (await fetch(`${origin}/allowed?csr`)).json()).toEqual({
        selected: 'ssr',
        method: 'GET',
      });
      expect(
        await (
          await fetch(`${origin}/allowed`, {
            headers: { 'x-modern-ssr-fallback': '' },
          })
        ).json(),
      ).toEqual({ selected: 'ssr', method: 'GET' });
      expect(
        await (
          await fetch(`${origin}/allowed`, {
            headers: { 'x-modernjs-ssr-fallback': '1' },
          })
        ).json(),
      ).toEqual({ selected: 'ssr', method: 'GET' });
    }
    for (const [pathname, init] of [
      ['/disabled?csr=1', { method: 'POST' }],
      ['/disabled?__loader=route&csr=1', { method: 'GET' }],
      ['/disabled?__ssrDirect=1&csr=1', { method: 'GET' }],
    ] as const) {
      expect(await (await fetch(`${origin}${pathname}`, init)).json()).toEqual({
        selected: 'ssr',
        method: init.method ?? 'GET',
      });
    }
    const head = await fetch(`${origin}${selected}`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  } finally {
    await close(server);
  }
});

it('rejects RSC on unmatched paths while retaining the real host not-found response', async () => {
  process.env.NODE_ENV = 'production';
  const { root, dist } = await fixture();
  const options = serverOptions(root, dist);
  options.routes[0].urlPath = '/app';
  const server = await createProdServer(options);
  const origin = await listen(server);
  try {
    expect((await fetch(`${origin}/missing`)).status).toBe(404);
    for (const name of ['x-rsc-tree', 'x-rsc-action']) {
      const response = await fetch(`${origin}/missing`, {
        headers: { [name]: '1' },
      });
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe(
        'unsupported-renderer-capability',
      );
    }
  } finally {
    await close(server);
  }
});

it.each([
  'unproven-build',
  'cancel',
  'stream-error',
] as const)('never caches a document with %s and never falls back after commit', async failure => {
  process.env.NODE_ENV = 'production';
  const { root, dist } = await fixture();
  const options = serverOptions(root, dist);
  let gets = 0;
  let writes = 0;
  let fallbacks = 0;
  options.plugins = [
    nativeServerPlugin({
      renderer: 'solid',
      entries: { main: identity },
      cacheAllowed: failure !== 'unproven-build',
      cache: {
        get: () => {
          gets++;
          return undefined;
        },
        set: () => {
          writes++;
        },
      },
      onError: () => {
        fallbacks++;
        return new Response('wrong post-commit fallback', { status: 503 });
      },
      resolveManifest: manifest => {
        const nativeManifest = manifest.renderBundles!
          .main as unknown as NativeServerManifest<NativeNodeBindings>;
        return {
          ...nativeManifest,
          async nativeRequestHandler(request, context) {
            const nativeResponse = await nativeManifest.nativeRequestHandler(
              request,
              context,
            );
            context.session.resolveResponse({
              kind: 'document',
              status: 200,
              headers: [['content-type', 'text/html']],
              cache: { mode: 'public', maxAgeSeconds: 60 },
            });
            return context.session.respond(nativeResponse.body);
          },
        };
      },
    }),
  ];
  const server = await createProdServer(options);
  const origin = await listen(server);
  try {
    const abort = new AbortController();
    const pathname = failure === 'unproven-build' ? '/' : `/${failure}`;
    const response = await fetch(`${origin}${pathname}`, {
      signal: abort.signal,
    });
    expect(response.status).toBe(200);
    if (failure === 'unproven-build')
      expect(await response.text()).toBe('native:solid:build-a');
    if (failure === 'stream-error')
      await expect(response.text()).rejects.toThrow();
    if (failure === 'cancel') {
      expect(
        new TextDecoder().decode(
          (await response.body!.getReader().read()).value,
        ),
      ).toBe('cancel shell');
      abort.abort();
      let cancellation = '';
      for (let retry = 0; retry < 30 && !cancellation; retry++) {
        await new Promise(resolve => setTimeout(resolve, 20));
        cancellation = await readFile(
          path.join(root, 'cancelled.txt'),
          'utf-8',
        ).catch(() => '');
      }
      expect(cancellation).toBe('cancelled');
    }
    await new Promise(resolve => setImmediate(resolve));
    expect(gets).toBe(failure === 'unproven-build' ? 0 : 1);
    expect(writes).toBe(0);
    expect(fallbacks).toBe(0);
  } finally {
    await close(server);
  }
});

it('uses the configured metadata fallback header for native CSR', async () => {
  process.env.NODE_ENV = 'production';
  const { root, dist } = await fixture();
  const options = serverOptions(root, dist);
  options.plugins = [
    nativeServerPlugin({
      renderer: 'solid',
      entries: { main: identity },
      resolveManifest: manifest => ({
        ...(manifest.renderBundles!
          .main as unknown as NativeServerManifest<NativeNodeBindings>),
        nativeRequestHandler: () => Response.json({ selected: 'ssr' }),
        nativeCSRRequestHandler: () => Response.json({ selected: 'csr' }),
      }),
    }),
  ];
  const server = await createProdServer({
    ...options,
    metaName: 'custom-app',
    config: {
      ...options.config,
      server: { ...options.config.server, ssr: { forceCSR: true } },
    },
  });
  const origin = await listen(server);
  try {
    expect(
      await (
        await fetch(`${origin}/`, { headers: { 'x-custom-ssr-fallback': '1' } })
      ).json(),
    ).toEqual({ selected: 'csr' });
    expect(
      await (
        await fetch(`${origin}/`, { headers: { 'x-modern-ssr-fallback': '1' } })
      ).json(),
    ).toEqual({ selected: 'ssr' });
    expect(
      await (
        await fetch(`${origin}/`, { headers: { 'x-custom-ssr-fallback': '' } })
      ).json(),
    ).toEqual({ selected: 'ssr' });
  } finally {
    await close(server);
  }
});
