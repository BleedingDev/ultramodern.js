import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RendererIdentity } from '@modern-js/backend-federation-contracts';
import { readNativeRendererWorkerResources } from '../../src/cloudflare/native-renderer';
import type { WorkerRendererBuild } from '../../src/cloudflare/renderer-identity';
import { createWorkerManifest } from '../../src/cloudflare/worker-manifest';

const buildId = 'a'.repeat(64);
const manifestUrl = 'https://remote.example/assets/mf-manifest.json';
const snapshotPath = '/en/_mf/fragment/widget';
const directories: string[] = [];
const identities: Record<string, RendererIdentity> = Object.fromEntries(
  ['main', 'publisher'].map(entryName => [
    entryName,
    {
      renderer: 'octane',
      appId: 'worker-federation-fixture',
      entryName,
      protocolVersion: 1,
      buildId,
    },
  ]),
);
const profile = {
  renderer: 'octane',
  protocolVersion: 1,
  compiler: { name: '@fixture/octane-compiler', version: '1.0.0' },
  hydration: { name: '@fixture/octane-runtime', version: '1.0.0' },
  router: {
    name: '@fixture/octane-router',
    version: '1.0.0',
    coreName: '@fixture/router-core',
    coreVersion: '1.0.0',
  },
};
const build: WorkerRendererBuild = {
  renderer: { name: 'octane', nativeDocuments: true, rsc: false },
  identities,
};

function nativeResources() {
  return {
    schema: 'ultramodern-native-worker-resources',
    version: 1,
    renderer: 'octane',
    entries: {
      main: {
        assets: [{ kind: 'script', href: '/static/main.js' }],
        nativeManifest: { buildId: 'native-main' },
        hydrationBuildId: 'native-main',
        serverConfig: { ssr: 'stream' },
      },
      publisher: {
        assets: [{ kind: 'script', href: '/static/publisher.js' }],
        nativeManifest: { buildId: 'native-publisher' },
        hydrationBuildId: 'native-publisher',
        serverConfig: { ssr: 'stream' },
      },
    },
    workerFederation: {
      renderer: {
        schema: 'ultramodern.renderer-federation',
        schemaVersion: 1,
        profile,
        runtime: { name: '@fixture/octane-runtime', version: '1.0.0' },
        bootstrap: { name: '@modern-js/renderer-octane', version: '3.8.3' },
        identities,
      },
      worker: {
        schema: 'ultramodern.worker-federation',
        schemaVersion: 1,
        remote: 'remote',
        exposes: {
          './Widget': {
            entryName: 'publisher',
            boundaryId: 'remoteContainer',
            paths: { en: snapshotPath, fr: '/fr/_mf/fragment/widget' },
            native: { publisherBuildId: 'native-publisher', runtimeABI: 1 },
          },
        },
      },
    },
    workerFederationManifestUrl: manifestUrl,
    workerFederationServices: [
      {
        remote: 'other',
        alias: 'otherContainer',
        manifestUrl: 'https://other.example/assets/mf-manifest.json',
        binding: 'OTHER_WORKER',
        fragments: [
          {
            expose: './OtherWidget',
            boundaryId: 'otherContainer',
            paths: { en: '/en/_mf/fragment/other-widget' },
          },
        ],
      },
    ],
  };
}

async function resourceFixture(value: unknown) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'native-worker-federation-'),
  );
  directories.push(directory);
  await fs.mkdir(path.join(directory, 'worker'));
  await fs.writeFile(
    path.join(directory, 'worker/native-renderer.json'),
    JSON.stringify(value),
  );
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map(directory => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('completed native Worker federation publication', () => {
  it('preserves the full authority, native client hash, and service topology', async () => {
    const resources = nativeResources();
    const directory = await resourceFixture(resources);
    await expect(
      readNativeRendererWorkerResources(directory, build),
    ).resolves.toEqual(resources);
  });

  const invalidPublications: [
    string,
    (value: ReturnType<typeof nativeResources>) => void,
  ][] = [
    [
      'generic build ID',
      (value: ReturnType<typeof nativeResources>) => {
        value.workerFederation.renderer.identities.publisher = {
          ...value.workerFederation.renderer.identities.publisher,
          buildId: 'wrong-build',
        };
      },
    ],
    [
      'missing generic entry',
      (value: ReturnType<typeof nativeResources>) => {
        delete value.workerFederation.renderer.identities.main;
      },
    ],
    [
      'extra generic entry',
      (value: ReturnType<typeof nativeResources>) => {
        value.workerFederation.renderer.identities.extra = {
          ...value.workerFederation.renderer.identities.main,
          entryName: 'extra',
        };
      },
    ],
    [
      'native client hash',
      (value: ReturnType<typeof nativeResources>) => {
        value.workerFederation.worker.exposes[
          './Widget'
        ].native.publisherBuildId = buildId;
      },
    ],
    [
      'native ABI',
      (value: ReturnType<typeof nativeResources>) => {
        value.workerFederation.worker.exposes['./Widget'].native.runtimeABI = 2;
      },
    ],
    [
      'missing native hash',
      (value: ReturnType<typeof nativeResources>) => {
        value.entries.publisher.hydrationBuildId = '';
      },
    ],
    [
      'unknown expose entry',
      (value: ReturnType<typeof nativeResources>) => {
        value.workerFederation.worker.exposes['./Widget'].entryName = 'missing';
      },
    ],
    [
      'unresolved locale path',
      (value: ReturnType<typeof nativeResources>) => {
        value.workerFederation.worker.exposes['./Widget'].paths.en =
          '/{locale}/_mf/fragment/widget';
      },
    ],
    [
      'query in endpoint',
      (value: ReturnType<typeof nativeResources>) => {
        value.workerFederation.worker.exposes['./Widget'].paths.en =
          `${snapshotPath}?fake=1`;
      },
    ],
    [
      'duplicate endpoint',
      (value: ReturnType<typeof nativeResources>) => {
        value.workerFederation.worker.exposes['./Widget'].paths.fr =
          snapshotPath;
      },
    ],
    [
      'untrusted manifest protocol',
      (value: ReturnType<typeof nativeResources>) => {
        value.workerFederationManifestUrl = 'file:///mf-manifest.json';
      },
    ],
    [
      'unresolved service path',
      (value: ReturnType<typeof nativeResources>) => {
        value.workerFederationServices[0].fragments[0].paths.en =
          '/{locale}/_mf/fragment/other-widget';
      },
    ],
    [
      'duplicate service remote',
      (value: ReturnType<typeof nativeResources>) => {
        value.workerFederationServices.push(value.workerFederationServices[0]);
      },
    ],
    [
      'duplicate service alias',
      (value: ReturnType<typeof nativeResources>) => {
        value.workerFederationServices.push({
          ...value.workerFederationServices[0],
          remote: 'another',
        });
      },
    ],
  ];
  it.each(invalidPublications)(
    'rejects a mismatched %s',
    async (_label, mutate) => {
      const value = structuredClone(nativeResources());
      mutate(value);
      const directory = await resourceFixture(value);
      await expect(
        readNativeRendererWorkerResources(directory, build),
      ).rejects.toThrow();
    },
  );

  it('requires a pinned URL for a producer publication', async () => {
    const { workerFederationManifestUrl: _url, ...value } = nativeResources();
    const directory = await resourceFixture(value);
    await expect(
      readNativeRendererWorkerResources(directory, build),
    ).rejects.toThrow('pinned manifest URL');
  });

  it('accepts a host with service topology and no exposed snapshots', async () => {
    const {
      workerFederation: _publication,
      workerFederationManifestUrl: _url,
      ...value
    } = nativeResources();
    const directory = await resourceFixture(value);
    await expect(
      readNativeRendererWorkerResources(directory, build),
    ).resolves.toEqual(value);
  });

  it('requires the exposed entry bundle and each compiled service binding at deploy', async () => {
    const directory = await resourceFixture(nativeResources());
    await fs.writeFile(
      path.join(directory, 'renderer-build.json'),
      JSON.stringify({
        schema: 'ultramodern-renderer-build',
        version: 2,
        renderer: 'octane',
        worker: build.renderer,
        buildId,
        profile,
        entries: identities,
      }),
    );
    const routes = [
      {
        entryName: 'main',
        urlPath: '/',
        entryPath: 'html/main/index.html',
        isSSR: true,
        worker: 'worker/main.js',
      },
      {
        entryName: 'publisher',
        urlPath: '/tools',
        entryPath: 'html/publisher/index.html',
        isSSR: true,
        worker: 'worker/publisher.js',
      },
    ];
    await fs.mkdir(path.join(directory, 'server'));
    await fs.writeFile(
      path.join(directory, 'server/route.json'),
      JSON.stringify({ routes }),
    );
    for (const entryName of ['main', 'publisher'])
      await fs.writeFile(path.join(directory, `worker/${entryName}.js`), '');
    const appContext = {
      apiOnly: false,
      appDirectory: directory,
      distDirectory: directory,
      serverPlugins: [],
    };
    await expect(
      createWorkerManifest(directory, {}, appContext, undefined),
    ).rejects.toThrow('OTHER_WORKER');
    const config = {
      deploy: {
        worker: {
          services: [{ binding: 'OTHER_WORKER', service: 'other-worker' }],
        },
      },
    };
    const manifest = await createWorkerManifest(
      directory,
      config,
      appContext,
      undefined,
    );
    expect(manifest.nativeRenderer).toEqual(nativeResources());
    await fs.rm(path.join(directory, 'worker/publisher.js'));
    await expect(
      createWorkerManifest(directory, config, appContext, undefined),
    ).rejects.toThrow('native worker build');
  });
});

type WorkerModule = Record<string, unknown>;
type Worker = {
  fetch(
    request: Request,
    env?: Record<string, unknown>,
    ctx?: unknown,
  ): Promise<Response>;
};
const pageRoutes = [
  {
    entryName: 'main',
    urlPath: '/',
    entryPath: 'html/main/index.html',
    isSSR: true,
    worker: 'worker/main.js',
    workerExists: true,
  },
  {
    entryName: 'publisher',
    urlPath: '/tools',
    entryPath: 'html/publisher/index.html',
    isSSR: true,
    worker: 'worker/publisher.js',
    workerExists: true,
  },
];
let templateSource: string;
beforeAll(async () => {
  const directory = path.resolve(__dirname, '../../src/templates');
  const filenames = (await fs.readdir(directory))
    .filter(filename => /^cloudflare-entry\.\d{3}-.*\.mjs$/u.test(filename))
    .sort();
  templateSource = (
    await Promise.all(
      filenames.map(filename =>
        fs.readFile(path.join(directory, filename), 'utf8'),
      ),
    )
  ).join('\n');
});

function emittedWorker(
  loaders: Record<string, () => Promise<WorkerModule>>,
  override: Record<string, unknown> = {},
): Worker {
  const source = templateSource
    .replace('export const modernWorkerManifest', 'const modernWorkerManifest')
    .replace('export default {', 'const worker = {');
  return new Function(
    'p_workerManifest',
    'p_workerModuleLoaders',
    `${source}\nreturn worker;`,
  )(
    {
      routeSpec: { routes: pageRoutes },
      renderer: build.renderer,
      rendererIdentities: identities,
      nativeRenderer: nativeResources(),
      resources: {
        routeManifest: 'routes-manifest.json',
        loadableStats: 'loadable-stats.json',
      },
      ...override,
    },
    loaders,
  ) as Worker;
}

describe('native Worker snapshot routing', () => {
  it.each(['POST', 'GET', 'HEAD'])(
    'selects the declared expose entry before prefixes and preserves %s',
    async method => {
      const env = {
        OTHER_WORKER: {
          fetch: () => {
            throw new Error('prefix fallback');
          },
        },
        ASSETS: {
          fetch: () => {
            throw new Error('asset fallback');
          },
        },
      };
      const ctx = { waitUntil() {}, passThroughOnException() {} };
      const request = new Request(
        `https://remote.example${snapshotPath}?__loader=x&a=1&a=2`,
        {
          method,
          headers: {
            'content-type': 'application/json',
            'x-native-codec': 'opaque',
          },
          ...(method === 'POST'
            ? { body: '{"payload":"native-codec-owned"}' }
            : {}),
        },
      );
      let observed:
        | { request: Request; options: Record<string, any>; body: string }
        | undefined;
      const worker = emittedWorker(
        {
          'worker/main.js': async () => {
            throw new Error('page fallback');
          },
          'worker/api.js': async () => {
            throw new Error('BFF fallback');
          },
          'worker/publisher.js': async () => ({
            dispatchNativeWorkerRequest: async (
              incoming: Request,
              options: Record<string, any>,
            ) => {
              observed = {
                request: incoming,
                options,
                body: await incoming.text(),
              };
              return Response.json({ native: true });
            },
          }),
        },
        {
          bff: { prefix: '/en/_mf', worker: 'worker/api.js' },
          serviceBindings: [
            { binding: 'OTHER_WORKER', prefix: '/en/_mf', interface: 'fetch' },
          ],
        },
      );
      const response = await worker.fetch(request, env, ctx);
      expect(response.status).toBe(200);
      expect(observed?.request).toBe(request);
      expect(observed?.request.method).toBe(method);
      expect(observed?.request.url).toBe(request.url);
      expect(observed?.request.headers.get('x-native-codec')).toBe('opaque');
      expect(observed?.body).toBe(
        method === 'POST' ? '{"payload":"native-codec-owned"}' : '',
      );
      expect(observed?.options.identity).toEqual(identities.publisher);
      expect(observed?.options.bindings).toBe(env);
      expect(observed?.options.executionContext).toBe(ctx);
      expect(observed?.options.resources).toEqual({
        ...nativeResources().entries.publisher,
        workerFederation: nativeResources().workerFederation,
        workerFederationManifestUrl: manifestUrl,
        workerFederationServices: nativeResources().workerFederationServices,
      });
      expect(
        JSON.parse(response.headers.get('x-ultramodern-renderer-identity')!),
      ).toEqual(identities.publisher);
      await expect(response.text()).resolves.toBe(
        method === 'HEAD' ? '' : '{"native":true}',
      );
    },
  );

  it.each([
    `${snapshotPath}/`,
    `${snapshotPath}/child`,
    '/en/_mf/fragment/%77idget',
    '/en/_mf/fragment%2Fwidget',
  ])('keeps %s in ordinary page routing', async pathname => {
    let snapshots = 0;
    const worker = emittedWorker({
      'worker/publisher.js': async () => {
        snapshots += 1;
        return {};
      },
      'worker/main.js': async () => ({
        dispatchNativeWorkerRequest: () => new Response('ordinary-page'),
      }),
    });
    const response = await worker.fetch(
      new Request(`https://remote.example${pathname}`),
    );
    await expect(response.text()).resolves.toBe('ordinary-page');
    expect(snapshots).toBe(0);
  });

  it('keeps a page without a producer publication in ordinary routing', async () => {
    const {
      workerFederation: _publication,
      workerFederationManifestUrl: _url,
      ...resources
    } = nativeResources();
    const worker = emittedWorker(
      {
        'worker/main.js': async () => ({
          dispatchNativeWorkerRequest: () => new Response('ordinary-page'),
        }),
      },
      { nativeRenderer: resources },
    );
    const response = await worker.fetch(
      new Request(`https://remote.example${snapshotPath}`),
    );
    await expect(response.text()).resolves.toBe('ordinary-page');
  });

  it.each([
    ['identity', 'missing-native-federation-entry'],
    ['route', 'missing-native-federation-entry'],
    ['resources', 'missing-native-renderer-resources'],
    ['loader', 'missing-native-worker-bundle'],
    ['export', 'missing-native-worker-bundle'],
    ['dispatcher', 'native-render-failed'],
  ])(
    'returns a controlled error for a missing %s without fallback',
    async (missing, code) => {
      const manifest: Record<string, unknown> = {
        bff: { prefix: '/en/_mf', worker: 'worker/api.js' },
        serviceBindings: [
          { binding: 'OTHER_WORKER', prefix: '/en/_mf', interface: 'fetch' },
        ],
      };
      if (missing === 'identity')
        manifest.rendererIdentities = { main: identities.main };
      if (missing === 'route') manifest.routeSpec = { routes: [pageRoutes[0]] };
      if (missing === 'resources') {
        const resources = nativeResources();
        manifest.nativeRenderer = {
          ...resources,
          entries: { main: resources.entries.main },
        };
      }
      const loaders = {
        'worker/main.js': async () => {
          throw new Error('page fallback');
        },
        'worker/api.js': async () => {
          throw new Error('BFF fallback');
        },
        ...(missing === 'loader'
          ? {}
          : {
              'worker/publisher.js': async () =>
                missing === 'export'
                  ? {}
                  : {
                      dispatchNativeWorkerRequest: () => {
                        throw new Error('native dispatcher failed');
                      },
                    },
            }),
      };
      const originalError = console.error;
      console.error = () => {};
      try {
        const response = await emittedWorker(loaders, manifest).fetch(
          new Request(`https://remote.example${snapshotPath}`, {
            method: 'POST',
            body: '{}',
          }),
          {
            OTHER_WORKER: {
              fetch: () => {
                throw new Error('service fallback');
              },
            },
            ASSETS: {
              fetch: () => {
                throw new Error('asset fallback');
              },
            },
          },
        );
        expect(response.status).toBe(500);
        expect(response.headers.get('cache-control')).toBe('no-store');
        await expect(response.json()).resolves.toEqual({
          code,
          entryName: 'publisher',
        });
      } finally {
        console.error = originalError;
      }
    },
  );
});
