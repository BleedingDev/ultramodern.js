import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCloudflarePreset } from '@modern-js/app-tools-extensions/cloudflare';

const directories: string[] = [];
const identityHeader = 'x-ultramodern-renderer-identity';
const buildMarker = 'a'.repeat(64);

type FixtureRoute = {
  entryName?: unknown;
  urlPath: string;
  entryPath: string;
  isSSR?: unknown;
  worker?: unknown;
  bundle?: unknown;
  isRSC?: unknown;
  isStream?: unknown;
  isSPA?: boolean;
};

function buildMetadata() {
  return {
    schema: 'ultramodern-renderer-build',
    version: 1,
    buildMarker,
    // This fixture qualifies transfer of compiler metadata, not compilation.
    profile: {
      renderer: 'fixture-renderer',
      protocolVersion: 1,
      compiler: { name: '@fixture/compiler', version: '1.0.0' },
      hydration: { name: '@fixture/runtime', version: '1.0.0' },
      router: {
        name: '@fixture/router',
        version: '1.0.0',
        coreName: '@fixture/router-core',
        coreVersion: '1.0.0',
      },
      sourceExtensions: ['.tsx'],
    },
    identities: Object.fromEntries(
      ['main', 'other'].map(entryName => [
        entryName,
        {
          renderer: 'fixture-renderer',
          appId: '@fixture/worker',
          entryName,
          protocolVersion: 1,
          buildId: buildMarker,
        },
      ]),
    ),
  };
}

const streamWorker = `
exports.controls = {};
function streamResponse(contentType) {
  const state = { pulls: 0 };
  const body = new ReadableStream({
    start(controller) { state.controller = controller; },
    pull() { state.pulls += 1; },
    cancel(reason) { state.cancelled = reason; },
  }, { highWaterMark: 0 });
  const headers = new Headers({
    'content-type': contentType,
    'x-worker-policy': 'preserved',
    'x-ultramodern-renderer-identity': '{"buildId":"stale"}',
  });
  headers.append('set-cookie', 'first=one; Path=/');
  headers.append('set-cookie', 'second=two; Path=/');
  state.response = new Response(body, {
    status: 202,
    statusText: 'Accepted by worker',
    headers,
  });
  exports.controls.latest = state;
  return state.response;
}
`;

async function fixture(
  options: {
    includeBuild?: boolean;
    rawBuild?: string;
    mutate?: (build: ReturnType<typeof buildMetadata>) => void;
    includePublicAsset?: boolean;
    mutateRoutes?: (routes: FixtureRoute[]) => void;
    nativeResources?: unknown;
  } = {},
) {
  const appDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'cloudflare-renderer-identity-'),
  );
  directories.push(appDirectory);
  const distDirectory = path.join(appDirectory, 'dist');
  const write = async (filename: string, bytes: string) => {
    const target = path.join(distDirectory, filename);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
  };
  const build = buildMetadata();
  options.mutate?.(build);
  if (options.includeBuild !== false)
    await write(
      'renderer-build.json',
      options.rawBuild ?? JSON.stringify(build),
    );
  const routes: FixtureRoute[] = ['main', 'other'].map(entryName => ({
    entryName,
    urlPath: entryName === 'main' ? '/' : '/other',
    entryPath: `html/${entryName}/index.html`,
    isSSR: true,
    worker: `worker/${entryName}.js`,
  }));
  await write('routes-manifest.json', JSON.stringify({ routeAssets: {} }));
  await write('loadable-stats.json', '{}');
  for (const route of routes)
    await write(route.entryPath, '<html><head></head><body></body></html>');
  if (options.includePublicAsset) {
    await write('public/favicon.ico', 'native public asset bytes');
    routes.push({
      urlPath: '/favicon.ico',
      isSPA: true,
      isSSR: false,
      entryPath: 'public/favicon.ico',
    });
  }
  options.mutateRoutes?.(routes);
  await write('route.json', JSON.stringify({ routes }));
  if (options.nativeResources !== undefined)
    await write(
      'worker/native-renderer.json',
      JSON.stringify(options.nativeResources),
    );
  await write(
    'worker/main.js',
    `${streamWorker}
exports.requestHandler = (_request, options) => new Response(
  '<html><head></head><body>document:' + options.resource.entryName + '</body></html>',
  { headers: { 'content-type': 'text/html', 'x-worker-policy': 'preserved' } },
);
exports.rscPayloadHandler = (request, options) => {
  exports.controls.method = request.method;
  exports.controls.resource = options.resource;
  return streamResponse('text/x-component');
};
exports.handleAction = async request => new Response(await request.text(), {
  status: 207,
  headers: { 'content-type': 'text/plain', 'x-worker-policy': 'action' },
});
`,
  );
  await write(
    'worker/other.js',
    `${streamWorker}\nexports.fetch = () => streamResponse('text/html');\n`,
  );
  const preset = createCloudflarePreset({
    appContext: {
      apiOnly: false,
      appDirectory,
      distDirectory,
      serverPlugins: [],
    },
    modernConfig: {},
    api: { isPluginExists: () => false },
  });
  await preset.prepare?.();
  return {
    build,
    preset,
    outputDirectory: path.join(appDirectory, '.output'),
  };
}

async function emittedWorker(input: Awaited<ReturnType<typeof fixture>>) {
  await input.preset.writeOutput?.();
  await input.preset.genEntry?.();
  const module = await import(
    pathToFileURL(path.join(input.outputDirectory, 'server/index.mjs')).href
  );
  const assets = {
    fetch: async (request: Request) => {
      const filename = path.join(
        input.outputDirectory,
        'public',
        new URL(request.url).pathname,
      );
      try {
        return new Response(await fs.readFile(filename));
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        )
          return new Response('missing', { status: 404 });
        throw error;
      }
    },
  };
  return {
    worker: module.default,
    manifest: module.modernWorkerManifest,
    assets,
  };
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map(directory => fs.rm(directory, { recursive: true, force: true })),
  );
});

it('binds generated entries to their exact built identities for document and action responses', async () => {
  const input = await fixture();
  const { worker, manifest, assets } = await emittedWorker(input);
  expect(manifest.rendererIdentities).toEqual(input.build.identities);
  const document = await worker.fetch(new Request('https://example.com/'), {
    ASSETS: assets,
  });
  expect(document.status).toBe(200);
  expect(JSON.parse(document.headers.get(identityHeader))).toEqual(
    input.build.identities.main,
  );
  expect(document.headers.get('x-worker-policy')).toBe('preserved');
  expect(await document.text()).toContain('document:main');
  const action = await worker.fetch(
    new Request('https://example.com/', {
      method: 'POST',
      headers: { 'x-rsc-action': 'fixture-action' },
      body: 'unchanged action input',
    }),
    { ASSETS: assets },
  );
  expect(action.status).toBe(207);
  expect(JSON.parse(action.headers.get(identityHeader))).toEqual(
    input.build.identities.main,
  );
  expect(action.headers.get('x-worker-policy')).toBe('action');
  expect(await action.text()).toBe('unchanged action input');
});

it('serves native public routes without assigning an application renderer identity', async () => {
  const input = await fixture({ includePublicAsset: true });
  const { worker, manifest, assets } = await emittedWorker(input);
  expect(manifest.rendererIdentities).toEqual(input.build.identities);
  const asset = await worker.fetch(
    new Request('https://example.com/favicon.ico'),
    { ASSETS: assets },
  );
  expect(asset.status).toBe(200);
  expect(asset.headers.get(identityHeader)).toBeNull();
  expect(await asset.text()).toBe('native public asset bytes');
  const document = await worker.fetch(new Request('https://example.com/'), {
    ASSETS: assets,
  });
  expect(JSON.parse(document.headers.get(identityHeader))).toEqual(
    input.build.identities.main,
  );
  expect(await document.text()).toContain('document:main');
});

it('accepts a native public route whose URL was remapped by publicRoutes', async () => {
  const input = await fixture({
    includePublicAsset: true,
    mutateRoutes(routes) {
      routes[2].urlPath = '/custom-public-path';
    },
  });
  await input.preset.writeOutput?.();
});

it.each([
  { name: 'missing SSR entry', isSSR: true, entryName: undefined },
  { name: 'missing CSR entry', isSSR: false, entryName: undefined },
  { name: 'null entry', isSSR: false, entryName: null },
  { name: 'nonstring entry', isSSR: false, entryName: 1 },
  { name: 'unknown entry', isSSR: false, entryName: 'unbuilt' },
])('rejects an application route with $name', async row => {
  const input = await fixture({
    includePublicAsset: true,
    mutateRoutes(routes) {
      Object.assign(routes[0], {
        entryName: row.entryName,
        isSSR: row.isSSR,
      });
      delete routes[0].worker;
    },
  });
  await expect(input.preset.writeOutput?.()).rejects.toThrow(
    'Cloudflare generated route has no built renderer identity',
  );
});

it.each([
  { name: 'SSR marker', patch: { isSSR: true } },
  { name: 'missing SSR marker', patch: { isSSR: undefined } },
  { name: 'malformed SSR marker', patch: { isSSR: 'false' } },
  { name: 'null entry name', patch: { entryName: null } },
  { name: 'unknown entry name', patch: { entryName: 'unbuilt' } },
  { name: 'worker dispatch', patch: { worker: 'worker/main.js' } },
  { name: 'malformed worker', patch: { worker: false } },
  { name: 'server bundle', patch: { bundle: 'bundles/main.js' } },
  { name: 'RSC marker', patch: { isRSC: true } },
  { name: 'stream marker', patch: { isStream: true } },
  { name: 'malformed RSC marker', patch: { isRSC: 'false' } },
  {
    name: 'application HTML path',
    patch: { entryPath: 'html/main/index.html' },
  },
  {
    name: 'traversal path',
    patch: { entryPath: 'public/../html/main/index.html' },
  },
  { name: 'noncanonical path', patch: { entryPath: 'public//favicon.ico' } },
  { name: 'backslash path', patch: { entryPath: 'public/dir\\favicon.ico' } },
  {
    name: 'public prefix lookalike',
    patch: { entryPath: 'public-other/favicon.ico' },
  },
  { name: 'missing file', patch: { entryPath: 'public/missing.ico' } },
  { name: 'directory path', patch: { entryPath: 'public/' } },
])('rejects a public-looking route with $name', async row => {
  const input = await fixture({
    includePublicAsset: true,
    mutateRoutes(routes) {
      Object.assign(routes[2], row.patch);
    },
  });
  await expect(input.preset.writeOutput?.()).rejects.toThrow();
});

it('decorates a pending native fetch stream without reading it and preserves cancellation and cookies', async () => {
  const input = await fixture();
  const { worker, assets } = await emittedWorker(input);
  const runtime = (
    await import(
      pathToFileURL(path.join(input.outputDirectory, 'worker/other.js')).href
    )
  ).default;
  const response = await worker.fetch(
    new Request('https://example.com/other'),
    {
      ASSETS: assets,
    },
  );
  const state = runtime.controls.latest;
  expect(JSON.parse(response.headers.get(identityHeader))).toEqual(
    input.build.identities.other,
  );
  expect(response.body).toBe(state.response.body);
  expect(response.body.locked).toBe(false);
  expect(state.pulls).toBe(0);
  expect(response.status).toBe(202);
  expect(response.statusText).toBe('Accepted by worker');
  expect(response.headers.get('x-worker-policy')).toBe('preserved');
  expect(response.headers.getSetCookie()).toEqual([
    'first=one; Path=/',
    'second=two; Path=/',
  ]);
  const reason = new Error('native consumer cancellation');
  await response.body.cancel(reason);
  expect(state.cancelled).toBe(reason);
});

it('decorates native Flight dispatch without buffering or swallowing a late stream error', async () => {
  const input = await fixture();
  const { worker, assets } = await emittedWorker(input);
  const runtime = (
    await import(
      pathToFileURL(path.join(input.outputDirectory, 'worker/main.js')).href
    )
  ).default;
  const response = await worker.fetch(
    new Request('https://example.com/', { headers: { 'x-rsc-tree': '1' } }),
    { ASSETS: assets },
  );
  const state = runtime.controls.latest;
  expect(runtime.controls.method).toBe('GET');
  expect(runtime.controls.resource.entryName).toBe('main');
  expect(runtime.controls.resource).not.toHaveProperty('htmlTemplate');
  expect(JSON.parse(response.headers.get(identityHeader))).toEqual(
    input.build.identities.main,
  );
  expect(response.headers.get('content-type')).toBe('text/x-component');
  expect(response.body).toBe(state.response.body);
  expect(state.pulls).toBe(0);
  const reader = response.body.getReader();
  state.controller.enqueue(new TextEncoder().encode('Flight shell'));
  expect(new TextDecoder().decode((await reader.read()).value)).toBe(
    'Flight shell',
  );
  const failure = new Error('native late Flight failure');
  state.controller.error(failure);
  await expect(reader.read()).rejects.toBe(failure);
});

it.each([
  'missing-entry',
  'entry-name',
  'build-marker',
  'protocol',
])('rejects a %s conflict instead of guessing a route identity', async conflict => {
  const input = await fixture({
    mutate(build) {
      if (conflict === 'missing-entry') delete build.identities.other;
      if (conflict === 'entry-name') build.identities.other.entryName = 'main';
      if (conflict === 'build-marker')
        build.identities.other.buildId = 'b'.repeat(64);
      if (conflict === 'protocol') build.identities.other.protocolVersion = 2;
    },
  });
  await expect(input.preset.writeOutput?.()).rejects.toThrow();
});

it('rejects malformed existing metadata and preserves output without a renderer manifest', async () => {
  const invalid = await fixture({ rawBuild: '{malformed renderer metadata' });
  await expect(invalid.preset.writeOutput?.()).rejects.toThrow(SyntaxError);
  const legacy = await fixture({ includeBuild: false });
  const { worker, manifest, assets } = await emittedWorker(legacy);
  expect(manifest).not.toHaveProperty('rendererIdentities');
  const response = await worker.fetch(new Request('https://example.com/'), {
    ASSETS: assets,
  });
  expect(response.headers.get(identityHeader)).toBeNull();
  expect(await response.text()).toContain('document:main');
});

describe('native worker resources', () => {
  const asSolid = (build: ReturnType<typeof buildMetadata>) => {
    build.profile.renderer = 'solid';
    for (const identity of Object.values(build.identities))
      identity.renderer = 'solid';
  };
  const entry = {
    assets: [{ kind: 'script', href: '/static/js/main.js' }],
    nativeManifest: { modules: {} },
    serverConfig: { ssr: 'stream' },
  };
  const resources = (entries: Record<string, unknown>) => ({
    schema: 'ultramodern-native-worker-resources',
    version: 1,
    renderer: 'solid',
    entries,
  });

  it('fails deploy before emitting a Solid worker without its native build', async () => {
    const input = await fixture({ mutate: asSolid });
    await expect(input.preset.writeOutput?.()).rejects.toThrow(
      'Cloudflare worker deploy of the solid renderer requires its native worker build for entry main. Set deploy.worker.ssr: true',
    );
  });

  it('inlines validated native document inputs for every Solid entry', async () => {
    const nativeResources = resources({ main: entry, other: entry });
    const input = await fixture({ mutate: asSolid, nativeResources });
    await input.preset.writeOutput?.();
    await input.preset.genEntry?.();
    const manifest = JSON.parse(
      await fs.readFile(
        path.join(input.outputDirectory, 'server/modern-worker-manifest.json'),
        'utf8',
      ),
    );
    expect(manifest.nativeRenderer).toEqual(nativeResources);
    await expect(
      fs.stat(path.join(input.outputDirectory, 'worker/native-renderer.json')),
    ).rejects.toThrow('ENOENT');
  });

  it.each([
    ['a missing entry', resources({ main: entry })],
    ['an unknown entry', resources({ main: entry, other: entry, x: entry })],
    [
      'no document assets',
      resources({ main: entry, other: { ...entry, assets: [] } }),
    ],
    [
      'another renderer',
      { ...resources({ main: entry, other: entry }), renderer: 'react' },
    ],
  ])('rejects resources with %s', async (_name, nativeResources) => {
    const input = await fixture({ mutate: asSolid, nativeResources });
    await expect(input.preset.writeOutput?.()).rejects.toThrow(
      'native renderer worker resources',
    );
  });
});
