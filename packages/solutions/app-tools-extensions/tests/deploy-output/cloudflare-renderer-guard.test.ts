import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createHandleAction } from '../../../../runtime/render/src/server/rsc/handle-action';

type Renderer = 'react' | 'solid' | 'octane';
type WorkerModule = Record<string, unknown>;
type WorkerLoader = () => Promise<WorkerModule>;
type WorkerEntry = {
  fetch(request: Request, env?: Record<string, unknown>): Promise<Response>;
};
type TemplateRuntime = {
  worker: WorkerEntry;
  dispatchRouteWorker(
    route: Record<string, unknown>,
    request: Request,
    env?: Record<string, unknown>,
  ): Promise<Response>;
  dispatchBffRequest(
    request: Request,
    env?: Record<string, unknown>,
  ): Promise<Response | null>;
};

const route = {
  urlPath: '/',
  entryName: 'main',
  entryPath: 'html/main/index.html',
  isSSR: true,
  worker: 'worker/main.js',
};
const profiles = {
  react: {
    compiler: { name: '@rsbuild/plugin-react', version: '2.1.1' },
    hydration: { name: 'react-dom', version: '19.3.0' },
    router: {
      name: '@tanstack/react-router',
      version: '1.170.39',
      coreName: '@tanstack/router-core',
      coreVersion: '1.171.32',
    },
  },
  solid: {
    compiler: { name: '@solidjs/compiler', version: '2.0.0-rc.13' },
    hydration: { name: '@solidjs/web', version: '2.0.0-rc.13' },
    router: {
      name: '@tanstack/solid-router',
      version: '2.0.0-rc.8',
      coreName: '@tanstack/router-core',
      coreVersion: '1.171.22',
    },
  },
  octane: {
    compiler: { name: '@octanejs/rspack-plugin', version: '0.1.55' },
    hydration: { name: 'octane', version: '0.7.1' },
    router: {
      name: '@octanejs/tanstack-router',
      version: '0.1.60',
      coreName: '@tanstack/router-core',
      coreVersion: '1.171.15',
    },
  },
};

function createManifest(renderer?: Renderer) {
  const deliveryUnit = {
    appId: 'catalog',
    build: 'fixture-build',
    buildMarker: 'fixture-build',
    deployProfile: 'cloudflare-ssr-mf-effect-v1',
    kind: 'microvertical-delivery-unit',
    packageName: '@fixture/catalog',
    schemaVersion: 1,
    sourceRevision: 'fixture-revision',
    unitId: 'fixture/catalog',
    version: '0.1.0',
  };
  const surfaces: Record<string, unknown> = {
    api: { ...deliveryUnit, surface: 'api' },
  };
  if (renderer) {
    surfaces.ui = {
      ...deliveryUnit,
      surface: 'ui',
      rendererIdentity: {
        renderer,
        appId: deliveryUnit.appId,
        entryName: 'main',
        protocolVersion: 1,
        buildId: deliveryUnit.buildMarker,
      },
      rendererProfile: {
        renderer,
        protocolVersion: 1,
        ...structuredClone(profiles[renderer]),
      },
    };
  }
  return {
    deliveryUnit: { ...deliveryUnit, surfaces },
    // The built renderer's adapter worker support, from renderer-build.json.
    ...(renderer
      ? {
          renderer: {
            name: renderer,
            nativeDocuments: renderer !== 'react',
            rsc: renderer === 'react',
          },
        }
      : {}),
    routeSpec: { routes: [route] },
    resources: {
      routeManifest: 'routes-manifest.json',
      loadableStats: 'loadable-stats.json',
    },
    security: { cors: { allowedOrigins: ['https://client.example'] } },
    bff: {
      worker: 'worker/__modern_bff_effect.js',
      prefix: '/api',
      runtimeFramework: 'effect',
      dispatcherExport: '__modern_create_effect_bff_dispatcher',
      effect: {
        crossProjectPolicy: {
          enabled: true,
          requireEnvelope: false,
          requireOperationContext: false,
          requireOperationContextDetails: false,
          requireOperationSchemaHash: false,
          requireOperationVersion: false,
          allowUnknownOperations: true,
          expectedOperationContracts: {},
        },
      },
    },
  };
}

let templateSource: string;
beforeAll(async () => {
  const templateDirectory = path.resolve(__dirname, '../../src/templates');
  const filenames = (await fs.readdir(templateDirectory))
    .filter(filename => /^cloudflare-entry\.\d{3}-.*\.mjs$/.test(filename))
    .sort();
  templateSource = (
    await Promise.all(
      filenames.map(filename =>
        fs.readFile(path.join(templateDirectory, filename), 'utf8'),
      ),
    )
  ).join('\n');
});

function evaluateEntry(
  manifest: ReturnType<typeof createManifest>,
  loaders: Record<string, WorkerLoader>,
): TemplateRuntime {
  // Execute every shipped fragment. Only replace ESM export syntax so the
  // template parameters and loader counters can stay in this test's realm.
  const source = templateSource
    .replace('export const modernWorkerManifest', 'const modernWorkerManifest')
    .replace('export default {', 'const worker = {');
  return new Function(
    'p_workerManifest',
    'p_workerModuleLoaders',
    `${source}\nreturn { worker, dispatchRouteWorker, dispatchBffRequest };`,
  )(manifest, loaders) as TemplateRuntime;
}

function createPoisonedRuntime(manifest: ReturnType<typeof createManifest>) {
  let evaluations = 0;
  const poison = async () => {
    evaluations += 1;
    throw new Error('Unsupported renderer evaluated a worker module');
  };
  const runtime = evaluateEntry(manifest, {
    [route.worker]: poison,
    [manifest.bff.worker]: poison,
  });
  return { runtime, evaluations: () => evaluations };
}

function createPublishedReactManifest() {
  const ownerRequire = createRequire(
    path.resolve(__dirname, '../../../ultramodern-app-tools/package.json'),
  );
  const sdk = ownerRequire('@modern-js/ultramodern-app-tools');
  const contracts = ownerRequire('@modern-js/backend-federation-contracts');
  const { stampFinalizedRendererBuildArtifact } = ownerRequire(
    '@modern-js/app-tools-extensions/release-envelope/renderer-output-stamp',
  );
  const manifest = createManifest('react');
  const profile = sdk.resolveRendererProfile('react');
  const { renderer, protocolVersion, compiler, hydration, router } = profile;
  const rendererProfile = {
    renderer,
    protocolVersion,
    compiler,
    hydration,
    router,
  };
  const buildMarker = 'a'.repeat(64);
  const sourceRevision = 'b'.repeat(40);
  const rendererIdentity = {
    renderer,
    protocolVersion,
    appId: manifest.deliveryUnit.appId,
    entryName: 'main',
    buildId: buildMarker,
  };
  const provider = { framework: 'react-router', ...router };
  const routerBindings = {
    main: {
      owner: '@fixture/react-router-owner',
      evidence: 'owned-default',
      defaultProvider: provider,
      providers: [provider],
    },
  };
  // A current public compiler metadata fixture, not a compiler execution claim.
  sdk.validateRendererBuildManifest(
    {
      schema: 'ultramodern-renderer-build',
      version: 2,
      renderer,
      profile,
      worker: { nativeDocuments: false, rsc: true },
      routerBindings,
      buildId: buildMarker,
      sourceRevision,
      entries: { main: rendererIdentity },
    },
    profile,
  );
  const { surfaces: _surfaces, ...deliveryUnit } = manifest.deliveryUnit;
  const source = contracts.createUltramodernBuildArtifact(
    { ...deliveryUnit, sourceRevision: 'workspace' },
    {
      ui: {
        identity: {
          ...rendererIdentity,
          buildId: deliveryUnit.buildMarker,
        },
        profile: rendererProfile,
        routerBindings,
      },
    },
  );
  const output = {
    buildMarker,
    sourceRevision,
    ui: { rendererIdentity, rendererProfile, routerBindings },
  };
  const context = {
    appDirectory: path.resolve(__dirname, 'fixtures/worker-renderer-profile'),
    distDirectory: path.resolve(
      __dirname,
      'fixtures/worker-renderer-profile/dist',
    ),
    entrypoints: [{ entryName: 'main', isMainEntry: true }],
  };
  const stamped = stampFinalizedRendererBuildArtifact(source, output, context);
  manifest.deliveryUnit = {
    ...stamped.deliveryUnit,
    surfaces: stamped.surfaces,
  };
  return {
    manifest,
    source,
    output,
    context,
    stampFinalizedRendererBuildArtifact,
  };
}

it('admits the current public React router core identity from a finalized artifact', async () => {
  const { manifest, output } = createPublishedReactManifest();
  expect(output.ui.rendererProfile.router.coreName).toBeTruthy();
  let evaluations = 0;
  const runtime = evaluateEntry(manifest, {
    [route.worker]: async () => {
      evaluations += 1;
      return { fetch: () => new Response('public finalized React profile') };
    },
  });
  const response = await runtime.worker.fetch(
    new Request('https://example.com/'),
  );
  expect(response.status).toBe(200);
  await expect(response.text()).resolves.toBe('public finalized React profile');
  expect(evaluations).toBe(1);
});

it.each([
  ['coreName', '@foreign/router-core'],
  ['coreVersion', '99.0.0'],
] as const)('keeps finalized router %s bound to the actual compiler profile', (field, value) => {
  const { source, output, context, stampFinalizedRendererBuildArtifact } =
    createPublishedReactManifest();
  const foreign = structuredClone(output);
  foreign.ui.rendererProfile.router[field] = value;
  expect(() =>
    stampFinalizedRendererBuildArtifact(source, foreign, context),
  ).toThrow(/captured application profile or router bindings/);
});

it.each([
  'missing-core-name',
  'missing-core-version',
  'noncanonical-core-name',
  'ranged-core-version',
  'extra-core-field',
] as const)('rejects %s in published router metadata before importing a worker', async invalid => {
  const { manifest: authoritativeManifest } = createPublishedReactManifest();
  const manifest = structuredClone(authoritativeManifest);
  const ui = manifest.deliveryUnit.surfaces.ui as Record<string, unknown>;
  const profile = ui.rendererProfile as Record<string, unknown>;
  const router = profile.router as Record<string, unknown>;
  if (invalid === 'missing-core-name') delete router.coreName;
  if (invalid === 'missing-core-version') delete router.coreVersion;
  if (invalid === 'noncanonical-core-name') router.coreName = ' react-router ';
  if (invalid === 'ranged-core-version') router.coreVersion = '^1.0.0';
  if (invalid === 'extra-core-field') router.coreAlias = 'react-router';
  const { runtime, evaluations } = createPoisonedRuntime(manifest);
  const response = await runtime.worker.fetch(
    new Request('https://example.com/'),
  );
  expect(response.status).toBe(500);
  await expect(response.json()).resolves.toEqual({
    code: 'invalid-renderer-metadata',
  });
  expect(evaluations()).toBe(0);
});

const moduleForms = [
  'fetch',
  'requestHandler',
  'default-function',
  'nested-default-fetch',
] as const;
function createRouteModule(
  form: (typeof moduleForms)[number],
  handler: () => Response,
): WorkerModule {
  switch (form) {
    case 'fetch':
      return { fetch: handler };
    case 'requestHandler':
      return { requestHandler: handler };
    case 'default-function':
      return { default: handler };
    case 'nested-default-fetch':
      return { default: { default: { fetch: handler } } };
  }
}

describe.each([
  'solid',
  'octane',
] as const)('%s Cloudflare rejection', renderer => {
  it.each([
    ['GET', '/'],
    ['POST', '/api/items'],
    ['GET', '/static/app.js'],
    ['HEAD', '/'],
    ['OPTIONS', '/api/items'],
  ])('rejects %s %s before loaders or asset dispatch', async (method, pathname) => {
    const { runtime, evaluations } = createPoisonedRuntime(
      createManifest(renderer),
    );
    let assets = 0;
    const response = await runtime.worker.fetch(
      new Request(`https://example.com${pathname}`, {
        method,
        headers: { origin: 'https://client.example' },
      }),
      {
        ASSETS: {
          fetch: () => {
            assets += 1;
            throw new Error('Unsupported renderer dispatched an asset');
          },
        },
      },
    );
    expect(response.status).toBe(501);
    expect(response.headers.get('cache-control')).toBe('no-store');
    if (method !== 'HEAD') {
      await expect(response.json()).resolves.toEqual({
        code: 'unsupported-renderer-capability',
        capability: 'cloudflare-worker',
        renderer,
      });
    }
    expect(evaluations()).toBe(0);
    expect(assets).toBe(0);
  });

  it.each([
    'x-rsc-tree',
    'x-rsc-action',
  ])('rejects %s presence before the Effect BFF loader', async header => {
    const { runtime, evaluations } = createPoisonedRuntime(
      createManifest(renderer),
    );
    const response = await runtime.worker.fetch(
      new Request('https://example.com/api/items', {
        method: 'POST',
        headers: { [header]: '' },
      }),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      code: 'unsupported-renderer-capability',
      capability: 'rsc',
    });
    expect(evaluations()).toBe(0);
  });

  it.each(
    moduleForms,
  )('guards direct route %s dispatch before import', async form => {
    let evaluations = 0;
    const runtime = evaluateEntry(createManifest(renderer), {
      [route.worker]: async () => {
        evaluations += 1;
        return createRouteModule(form, () => {
          throw new Error('Unsupported renderer handler executed');
        });
      },
    });
    const response = await runtime.dispatchRouteWorker(
      route,
      new Request('https://example.com/'),
    );
    expect(response.status).toBe(501);
    expect(evaluations).toBe(0);
  });

  it('guards direct BFF dispatch before import', async () => {
    const { runtime, evaluations } = createPoisonedRuntime(
      createManifest(renderer),
    );
    expect(
      (
        await runtime.dispatchBffRequest(
          new Request('https://example.com/api/items'),
        )
      )?.status,
    ).toBe(501);
    expect(evaluations()).toBe(0);
  });

  it.each([
    'x-rsc-tree',
    'x-rsc-action',
  ])('guards direct route and BFF %s requests before import', async header => {
    const manifest = createManifest(renderer);
    const ui = manifest.deliveryUnit.surfaces.ui as Record<string, unknown>;
    const profile = ui.rendererProfile as Record<string, unknown>;
    profile.renderer = 'react';
    const { runtime, evaluations } = createPoisonedRuntime(manifest);
    const request = new Request('https://example.com/api/items', {
      headers: { [header]: '' },
    });
    for (const response of [
      await runtime.dispatchRouteWorker(route, request),
      await runtime.dispatchBffRequest(request),
    ]) {
      expect(response?.status).toBe(400);
      await expect(response?.json()).resolves.toEqual({
        code: 'unsupported-renderer-capability',
        capability: 'rsc',
      });
    }
    expect(evaluations()).toBe(0);
  });
});

it.each([
  { name: 'UI object', fields: [], value: null },
  { name: 'renderer identity', fields: ['rendererIdentity'], value: undefined },
  { name: 'renderer profile', fields: ['rendererProfile'], value: undefined },
  {
    name: 'renderer pairing',
    fields: ['rendererProfile', 'renderer'],
    value: 'react',
  },
  {
    name: 'app identity',
    fields: ['rendererIdentity', 'appId'],
    value: 'other',
  },
  {
    name: 'stamped build',
    fields: ['rendererIdentity', 'buildId'],
    value: 'old-build',
  },
  {
    name: 'entry identity',
    fields: ['rendererIdentity', 'entryName'],
    value: '',
  },
  {
    name: 'identity protocol',
    fields: ['rendererIdentity', 'protocolVersion'],
    value: 2,
  },
  {
    name: 'profile protocol',
    fields: ['rendererProfile', 'protocolVersion'],
    value: 2,
  },
  {
    name: 'compiler tuple',
    fields: ['rendererProfile', 'compiler', 'version'],
    value: '^2.0.0',
  },
  {
    name: 'hydration tuple',
    fields: ['rendererProfile', 'hydration', 'name'],
    value: '',
  },
  {
    name: 'router tuple',
    fields: ['rendererProfile', 'router', 'coreVersion'],
    value: undefined,
  },
])('rejects malformed native $name before loading', async ({
  fields,
  value,
}) => {
  const manifest = createManifest('solid');
  if (fields.length === 0) {
    manifest.deliveryUnit.surfaces.ui = value;
  } else {
    let current = manifest.deliveryUnit.surfaces.ui as Record<string, unknown>;
    for (const field of fields.slice(0, -1)) {
      current = current[field] as Record<string, unknown>;
    }
    current[fields[fields.length - 1]!] = value;
  }
  const { runtime, evaluations } = createPoisonedRuntime(manifest);
  const response = await runtime.worker.fetch(
    new Request('https://example.com/'),
  );
  expect(response.status).toBe(500);
  await expect(response.json()).resolves.toEqual({
    code: 'invalid-renderer-metadata',
  });
  expect(evaluations()).toBe(0);
});

it.each(
  moduleForms,
)('preserves React %s worker dispatch and RSC requests', async form => {
  let evaluations = 0;
  let executions = 0;
  const runtime = evaluateEntry(createManifest('react'), {
    [route.worker]: async () => {
      evaluations += 1;
      return createRouteModule(form, () => {
        executions += 1;
        return new Response('React fixture worker');
      });
    },
  });
  const response = await runtime.worker.fetch(
    new Request('https://example.com/', { headers: { 'x-rsc-tree': '' } }),
    {
      ASSETS: {
        fetch: async (request: Request) =>
          new Response(
            new URL(request.url).pathname.endsWith('.json')
              ? '{}'
              : '<html></html>',
          ),
      },
    },
  );
  expect(response.status).toBe(200);
  await expect(response.text()).resolves.toBe('React fixture worker');
  expect(evaluations).toBe(1);
  expect(executions).toBe(1);
});

it('preserves headless Effect BFF dispatch despite its universal API identity', async () => {
  const manifest = createManifest();
  expect(Object.hasOwn(manifest.deliveryUnit.surfaces, 'ui')).toBe(false);
  let evaluations = 0;
  let executions = 0;
  const runtime = evaluateEntry(manifest, {
    [manifest.bff.worker]: async () => {
      evaluations += 1;
      return {
        __modern_create_effect_bff_dispatcher: async () => ({
          dispatch: async () => {
            executions += 1;
            return new Response('Effect API fixture');
          },
          dispose: async () => {},
        }),
      };
    },
  });
  // The Effect BFF runtime is scoped to the Worker request's ExecutionContext.
  const response = await runtime.worker.fetch(
    new Request('https://example.com/api/items', {
      method: 'POST',
      headers: { 'x-rsc-action': '' },
    }),
    {},
    { waitUntil() {}, passThroughOnException() {} },
  );
  expect(response.status).toBe(200);
  await expect(response.text()).resolves.toBe('Effect API fixture');
  expect(evaluations).toBe(1);
  expect(executions).toBe(1);
});

it.each([
  'direct',
  'redirected',
] as const)('loads %s rendering assets without changing the native React POST request', async assetMode => {
  const controller = new AbortController();
  const request = new Request('https://example.com/?intent=submit', {
    method: 'POST',
    headers: {
      'content-type': 'text/plain',
      cookie: 'session=native-post',
      origin: 'https://client.example',
      'x-native-request': 'preserved',
    },
    body: 'native POST body',
    redirect: 'manual',
    signal: controller.signal,
  });
  const htmlTemplate = '<html><head></head><body>native template</body></html>';
  const routeManifest = { routeAssets: { main: {} } };
  const loadableStats = { chunks: ['native-client-slot'] };
  const assetRequests: Request[] = [];
  let executions = 0;
  const runtime = evaluateEntry(createManifest('react'), {
    [route.worker]: async () => ({
      requestHandler: async (
        receivedRequest: Request,
        options: Record<string, unknown>,
      ) => {
        executions += 1;
        expect(receivedRequest).toBe(request);
        expect(receivedRequest.method).toBe('POST');
        expect(receivedRequest.bodyUsed).toBe(false);
        expect(receivedRequest.headers.get('cookie')).toBe(
          'session=native-post',
        );
        expect(receivedRequest.headers.get('x-native-request')).toBe(
          'preserved',
        );
        expect(receivedRequest.signal).toBe(request.signal);
        expect(options.resource).toMatchObject({
          htmlTemplate: expect.stringContaining('<body>native template</body>'),
          routeManifest,
          loadableStats,
        });
        return new Response(await receivedRequest.text(), { status: 202 });
      },
    }),
  });
  const response = await runtime.worker.fetch(request, {
    ASSETS: {
      fetch: async (assetRequest: Request) => {
        assetRequests.push(assetRequest);
        expect(assetRequest.method).toBe('GET');
        expect(assetRequest.redirect).toBe('manual');
        expect(assetRequest.body).toBeNull();
        await expect(assetRequest.text()).resolves.toBe('');
        expect(assetRequest.headers.get('cookie')).toBe('session=native-post');
        expect(assetRequest.headers.get('x-native-request')).toBe('preserved');
        expect(assetRequest.signal.aborted).toBe(false);
        expect(request.bodyUsed).toBe(false);
        const url = new URL(assetRequest.url);
        expect(url.origin).toBe('https://example.com');
        expect(url.search).toBe('?intent=submit');
        if (url.pathname === '/html/main/index.html') {
          return assetMode === 'redirected'
            ? new Response(null, {
                status: 302,
                headers: { location: '/html/main/resolved.html' },
              })
            : new Response(htmlTemplate);
        }
        if (url.pathname === '/html/main/resolved.html') {
          return new Response(htmlTemplate);
        }
        if (url.pathname === '/routes-manifest.json') {
          return Response.json(routeManifest);
        }
        if (url.pathname === '/loadable-stats.json') {
          return Response.json(loadableStats);
        }
        throw new Error(`Unexpected rendering asset: ${url.pathname}`);
      },
    },
  });
  expect(response.status).toBe(202);
  await expect(response.text()).resolves.toBe('native POST body');
  expect(executions).toBe(1);
  expect(
    assetRequests.map(asset => new URL(asset.url).pathname).sort(),
  ).toEqual(
    [
      '/html/main/index.html',
      ...(assetMode === 'redirected' ? ['/html/main/resolved.html'] : []),
      '/routes-manifest.json',
      '/loadable-stats.json',
    ].sort(),
  );
  controller.abort();
  expect(request.signal.aborted).toBe(true);
  expect(assetRequests.every(asset => asset.signal.aborted)).toBe(true);
});

it('keeps rejecting external static asset POST requests without consuming their body', async () => {
  let assetReads = 0;
  let workerLoads = 0;
  const runtime = evaluateEntry(createManifest('react'), {
    [route.worker]: async () => {
      workerLoads += 1;
      throw new Error('Static asset POST reached a route worker');
    },
  });
  const request = new Request('https://example.com/static/main.js', {
    method: 'POST',
    body: 'external static POST body',
  });
  const response = await runtime.worker.fetch(request, {
    ASSETS: {
      fetch: async () => {
        assetReads += 1;
        return new Response('static asset');
      },
    },
  });
  expect(response.status).toBe(404);
  expect(assetReads).toBe(0);
  expect(workerLoads).toBe(0);
  expect(request.bodyUsed).toBe(false);
  await expect(request.text()).resolves.toBe('external static POST body');
});

describe('React native RSC worker dispatch', () => {
  it('preserves a self-contained fetch handler with native headers and exports', async () => {
    const request = new Request('https://example.com/', {
      method: 'POST',
      headers: { 'x-rsc-action': 'native-action-id', 'x-rsc-tree': '1' },
      body: 'fetch-owned body',
    });
    const env = { binding: 'fetch-owned binding' };
    const runtime = evaluateEntry(createManifest('react'), {
      [route.worker]: async () => ({
        fetch: async (receivedRequest: Request, receivedEnv: unknown) => {
          expect(receivedRequest).toBe(request);
          expect(receivedEnv).toBe(env);
          return new Response(await receivedRequest.text(), { status: 203 });
        },
        handleAction: () => {
          throw new Error('Self-contained fetch lost control of its request');
        },
        rscPayloadHandler: () => {
          throw new Error('Self-contained fetch executed another handler');
        },
      }),
    });
    const response = await runtime.worker.fetch(request, env);
    expect(response.status).toBe(203);
    await expect(response.text()).resolves.toBe('fetch-owned body');
  });

  it.each([
    undefined,
    '',
  ])('keeps ordinary HTML HEAD rendering and empty RSC header semantics (%s)', async header => {
    const runtime = evaluateEntry(createManifest('react'), {
      [route.worker]: async () => ({
        requestHandler: (request: Request) => {
          expect(request.method).toBe('GET');
          return new Response('HTML rendered for HEAD', {
            headers: { 'content-type': 'text/html', 'x-html-head': 'retained' },
          });
        },
      }),
    });
    const response = await runtime.worker.fetch(
      new Request('https://example.com/', {
        method: 'HEAD',
        headers: header === undefined ? {} : { 'x-rsc-tree': header },
      }),
      {
        ASSETS: {
          fetch: async (request: Request) =>
            new Response(
              new URL(request.url).pathname.endsWith('.json')
                ? '{}'
                : '<html><head></head></html>',
            ),
        },
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('x-html-head')).toBe('retained');
    await expect(response.text()).resolves.toBe('');
  });

  it.each([
    'named',
    'nested-default',
  ] as const)('awaits the %s Flight handler with request-local native resources', async form => {
    const received: Record<string, unknown>[] = [];
    const resourceReads: string[] = [];
    const flightResponse = new Response('native Flight bytes', {
      status: 202,
      headers: { 'x-native-flight': 'preserved' },
    });
    const module = {
      requestHandler: () => {
        throw new Error('Flight request executed HTML rendering');
      },
      rscPayloadHandler: Promise.resolve(
        async (request: Request, options: Record<string, unknown>) => {
          expect(request.headers.get('x-rsc-tree')).toBe('1');
          const context = options.loaderContext as Map<string, unknown>;
          expect(context.get('request-url')).toBeUndefined();
          context.set('request-url', request.url);
          expect(context.get('request-url')).toBe(request.url);
          received.push(options);
          return flightResponse.clone();
        },
      ),
    };
    const runtime = evaluateEntry(createManifest('react'), {
      [route.worker]: async () =>
        form === 'named' ? module : { default: { default: module } },
    });
    const env = {
      ASSETS: {
        fetch: async (request: Request) => {
          const pathname = new URL(request.url).pathname;
          resourceReads.push(pathname);
          if (pathname === '/routes-manifest.json') {
            return Response.json({ routeAssets: { main: {} } });
          }
          if (pathname === '/loadable-stats.json') {
            return Response.json({ chunks: ['client-slot'] });
          }
          throw new Error(`Flight requested an HTML resource: ${pathname}`);
        },
      },
    };
    for (let index = 0; index < 2; index += 1) {
      const response = await runtime.worker.fetch(
        new Request('https://example.com/composite', {
          headers: { 'x-rsc-tree': '1', origin: 'https://client.example' },
        }),
        env,
      );
      expect(response.status).toBe(202);
      expect(response.headers.get('x-native-flight')).toBe('preserved');
      expect(response.headers.get('content-type')).toBe(
        flightResponse.headers.get('content-type'),
      );
      expect(response.headers.get('access-control-allow-origin')).toBe(
        'https://client.example',
      );
      await expect(response.text()).resolves.toBe('native Flight bytes');
    }
    expect(received).toHaveLength(2);
    const resource = received[0]?.resource as Record<string, unknown>;
    expect(resource).toMatchObject({
      route,
      entryName: 'main',
      routeManifest: { routeAssets: { main: {} } },
      loadableStats: { chunks: ['client-slot'] },
    });
    expect(resource).not.toHaveProperty('htmlTemplate');
    expect(received[0]?.loaderContext).toBeInstanceOf(Map);
    expect(received[0]?.loaderContext).not.toBe(received[1]?.loaderContext);
    expect(resourceReads).toEqual([
      '/routes-manifest.json',
      '/loadable-stats.json',
      '/routes-manifest.json',
      '/loadable-stats.json',
    ]);
  });

  it('prioritizes the native action handler and leaves the request body untouched', async () => {
    const decoded: Array<string | FormData> = [];
    const argsReceived: unknown[][] = [];
    const nativeAction = createHandleAction({
      decodeReply: async body => {
        decoded.push(body);
        return [7];
      },
      loadServerAction: actionId => {
        expect(actionId).toBe('compiler-generated-action-id');
        return (value: number) => value + 1;
      },
      renderRsc: ({ element }) =>
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(String(element)));
            controller.close();
          },
        }),
    });
    const runtime = evaluateEntry(createManifest('react'), {
      [route.worker]: async () => ({
        handleAction: (...args: [Request]) => {
          argsReceived.push(args);
          return nativeAction(...args);
        },
        rscPayloadHandler: () => {
          throw new Error('Action request executed Flight tree rendering');
        },
        requestHandler: () => {
          throw new Error('Action request executed HTML rendering');
        },
      }),
    });
    const request = new Request('https://example.com/', {
      method: 'POST',
      headers: {
        'x-rsc-action': 'compiler-generated-action-id',
        'x-rsc-tree': '1',
        'content-type': 'text/plain',
      },
      body: 'native encoded reply',
    });
    const response = await runtime.worker.fetch(request, {
      ASSETS: {
        fetch: () => {
          throw new Error('Action loaded SSR or Flight resources');
        },
      },
    });
    expect(argsReceived).toEqual([[request]]);
    expect(decoded).toEqual(['native encoded reply']);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/x-component');
    await expect(response.text()).resolves.toBe('8');
  });

  it.each([
    'GET',
    'HEAD',
    'PUT',
  ])('preserves the native action %s method rejection and Allow header', async method => {
    const methods: string[] = [];
    const nativeAction = createHandleAction({
      decodeReply: async () => {
        throw new Error('Invalid method decoded an action body');
      },
      loadServerAction: () => {
        throw new Error('Invalid method loaded an action');
      },
      renderRsc: () => {
        throw new Error('Invalid method rendered Flight');
      },
    });
    const runtime = evaluateEntry(createManifest('react'), {
      [route.worker]: async () => ({
        handleAction: (request: Request) => {
          methods.push(request.method);
          return nativeAction(request);
        },
        requestHandler: () => {
          throw new Error('Invalid action method fell back to HTML');
        },
      }),
    });
    const response = await runtime.worker.fetch(
      new Request('https://example.com/', {
        method,
        headers: { 'x-rsc-action': 'native-action-id' },
      }),
    );
    expect(methods).toEqual([method]);
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    await expect(response.text()).resolves.toBe(
      method === 'HEAD' ? '' : 'Method not allowed',
    );
  });

  it.each([
    ['x-rsc-tree', 'Cannot find request handler for RSC'],
    ['x-rsc-action', 'Cannot find server action handler'],
  ])('fails closed when %s has no native export', async (header, message) => {
    const runtime = evaluateEntry(createManifest('react'), {
      [route.worker]: async () => ({
        requestHandler: () => {
          throw new Error('Missing RSC export fell back to HTML');
        },
      }),
    });
    const response = await runtime.worker.fetch(
      new Request('https://example.com/', {
        method: 'POST',
        headers: { [header]: 'native-reference' },
      }),
    );
    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toBe(message);
  });
});
