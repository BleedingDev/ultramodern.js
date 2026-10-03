import path from 'node:path';
import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import type {
  NativeRequestContext,
  NativeRequestHandler,
} from '@modern-js/renderer-core/server';
import {
  OCTANE_COMPILER_VERSION,
  OCTANE_RUNTIME_VERSION,
} from '@modern-js/renderer-octane/manifest';
import { SOLID_COMPILER_VERSION } from '@modern-js/renderer-solid/manifest';
import { fileReader } from '@modern-js/runtime-utils/fileReader';
import {
  createServerBase,
  injectRenderHandlerPlugin,
  type Render,
  type RenderOptions,
  type ServerBaseOptions,
  type ServerPlugin,
} from '../../../../server/core/src';
import {
  type NativeDevelopmentSnapshot,
  type NativeNodeBindings,
  type NativeServerPluginOptions,
  nativeServerPlugin,
} from '../../src/native-composition/native-server-plugin';

const identity: RendererIdentity = {
  renderer: 'solid',
  appId: 'development-provider-proof',
  entryName: 'main',
  protocolVersion: 1,
  buildId: 'development-profile',
};
const runtimes: ReturnType<typeof createServerBase>[] = [];
const monitors: RenderOptions['monitors'] = {
  push() {},
  error() {},
  warn() {},
  debug() {},
  info() {},
  trace() {},
  timing() {},
  counter() {},
};

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(runtime => runtime.dispose()));
  rstest.restoreAllMocks();
  rstest.unstubAllEnvs();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(settle => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function installedRender(options: NativeServerPluginOptions) {
  const root = path.resolve(import.meta.dirname, '../../../../..');
  const baseOptions: ServerBaseOptions = {
    pwd: root,
    appContext: { appDirectory: root },
    routes: Object.keys(options.entries).map(entryName => ({
      urlPath: entryName === 'main' ? '/' : `/${entryName}`,
      entryName,
      entryPath: `${entryName}.html`,
      bundle: `bundles/${entryName}.mjs`,
      isSSR: true,
    })),
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
  };
  let render: Render | undefined;
  const capture: ServerPlugin = {
    name: 'native-development-provider-capture',
    pre: [
      '@modern-js/native-node-dispatch',
      '@modern-js/native-node-terminal-responses',
    ],
    setup(api) {
      api.onPrepare(() => {
        const candidate = api.getServerContext().render;
        if (typeof candidate !== 'function') {
          throw new Error('Native development render was not installed.');
        }
        render = candidate;
      });
    },
  };
  const runtime = createServerBase(baseOptions);
  runtimes.push(runtime);
  runtime.addPlugins([
    injectRenderHandlerPlugin({}),
    nativeServerPlugin(options),
    capture,
  ]);
  await runtime.init();
  if (!render) throw new Error('Native development render was not captured.');
  return render;
}

function requestOptions(entryName = 'main'): RenderOptions {
  return {
    monitors,
    templates: {},
    serverManifest: {},
    matchEntryName: entryName,
    loaderContext: new Map<string, unknown>(),
  };
}

function solidSnapshot(
  entryIdentity = identity,
  generation = 'first',
  handler?: NativeRequestHandler<NativeNodeBindings>,
): NativeDevelopmentSnapshot {
  return {
    manifest: {
      rendererIdentity: entryIdentity,
      nativeRequestHandler:
        handler ??
        ((_request, context) =>
          Response.json({
            generation,
            entryName: context.entry.entryName,
            assets: context.assets,
          })),
    },
    assets: [
      {
        kind: 'stylesheet',
        href: `/${generation}/${entryIdentity.entryName}.css`,
      },
      { kind: 'script', href: `/${generation}/${entryIdentity.entryName}.mjs` },
    ],
    nativeManifest: {
      schemaVersion: 1,
      renderer: 'solid',
      compilerVersion: SOLID_COMPILER_VERSION,
      rendererIdentity: entryIdentity,
      modules: {
        _base: `/${generation}/`,
        [entryIdentity.entryName]: { file: `${entryIdentity.entryName}.mjs` },
      },
    },
  };
}

function octaneSnapshot(
  entryIdentity: RendererIdentity,
  handler: NativeRequestHandler<NativeNodeBindings>,
): NativeDevelopmentSnapshot {
  return {
    manifest: {
      rendererIdentity: entryIdentity,
      nativeRequestHandler: handler,
    },
    assets: [{ kind: 'script', href: '/compiled/main.js' }],
    hydrationBuildId: 'native-compiled-first',
    nativeManifest: {
      schemaVersion: 1,
      renderer: 'octane',
      runtimeVersion: OCTANE_RUNTIME_VERSION,
      compilerVersion: OCTANE_COMPILER_VERSION,
      rendererIdentity: entryIdentity,
      nativeHydrationBuildId: 'native-compiled-first',
      sourceModules: [
        {
          resource: 'src/main.tsx',
          canonicalId: 'main',
          moduleId: 'main',
          transformKind: 'compile',
          sourceSha256: 'a'.repeat(64),
          emittedSourceSha256: 'b'.repeat(64),
          assets: ['compiled/main.js'],
        },
      ],
      assets: [{ file: 'compiled/main.js', sha256: 'c'.repeat(64) }],
    },
  };
}

function providerOptions(
  provider: NonNullable<
    NativeServerPluginOptions['resolveDevelopmentSnapshot']
  >,
): NativeServerPluginOptions {
  return {
    renderer: 'solid',
    entries: { main: identity },
    assetManifestFile: 'renderer-assets.json',
    nativeManifestFiles: { main: 'solid-module-manifest.main.json' },
    resolveDevelopmentSnapshot: provider,
  };
}

describe('native development compiler snapshot provider', () => {
  it('retains one generation for a request while a later generation is published', async () => {
    const entered = deferred<NativeRequestContext<NativeNodeBindings>>();
    const release = deferred<void>();
    const handler = rstest.fn(
      async (
        _request: Request,
        context: NativeRequestContext<NativeNodeBindings>,
      ) => {
        entered.resolve(context);
        await release.promise;
        return Response.json({ generation: 'first', assets: context.assets });
      },
    );
    const first = solidSnapshot(identity, 'first', handler);
    const second = solidSnapshot(identity, 'second');
    let published = first;
    const provider = rstest.fn(async () => published);
    const render = await installedRender(providerOptions(provider));
    const request = new Request('http://native.invalid/');
    const pending = render(request, requestOptions());
    const retained = await entered.promise;
    published = second;
    release.resolve(undefined);
    const firstResponse = await pending;
    expect(await firstResponse.json()).toEqual({
      generation: 'first',
      assets: first.assets,
    });
    expect(retained.nativeManifest).toBe(first.nativeManifest);
    expect(retained.assets).toEqual(first.assets);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(provider).toHaveBeenCalledWith(identity, request.signal);
    const nextResponse = await render(
      new Request('http://native.invalid/'),
      requestOptions(),
    );
    expect(await nextResponse.json()).toEqual({
      generation: 'second',
      entryName: 'main',
      assets: second.assets,
    });
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('uses the provider under NODE_ENV=production without reading files or the legacy resolver', async () => {
    rstest.stubEnv('NODE_ENV', 'production');
    const files = rstest
      .spyOn(fileReader, 'readFile')
      .mockImplementation(async () => {
        throw new Error('Development composition reached the file reader.');
      });
    const legacy = rstest.fn(() => {
      throw new Error('Development composition reached the legacy resolver.');
    });
    const snapshot = solidSnapshot();
    const provider = rstest.fn(async () => snapshot);
    const render = await installedRender({
      ...providerOptions(provider),
      resolveManifest: legacy,
    });
    const response = await render(
      new Request('http://native.invalid/'),
      requestOptions(),
    );
    expect(await response.json()).toEqual({
      generation: 'first',
      entryName: 'main',
      assets: snapshot.assets,
    });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(files).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
  });

  it('rejects cache admission when a development provider is configured', () => {
    expect(() =>
      nativeServerPlugin({
        ...providerOptions(async () => solidSnapshot()),
        cacheAllowed: true,
      }),
    ).toThrow(/development.*cache|cache.*development/iu);
  });

  const invalidSnapshots: ReadonlyArray<{
    name: string;
    invalid(snapshot: NativeDevelopmentSnapshot): NativeDevelopmentSnapshot;
    error: RegExp;
  }> = [
    {
      name: 'handler identity belongs to another entry',
      invalid: snapshot => ({
        ...snapshot,
        manifest: {
          ...snapshot.manifest,
          rendererIdentity: { ...identity, entryName: 'admin' },
        },
      }),
      error: /identity conflicts/iu,
    },
    {
      name: 'compiler identity belongs to another generation',
      invalid: snapshot => ({
        ...snapshot,
        nativeManifest: solidSnapshot({ ...identity, buildId: 'old-build' })
          .nativeManifest,
      }),
      error: /identity conflicts/iu,
    },
    {
      name: 'compiler manifest is missing',
      invalid: snapshot => ({ ...snapshot, nativeManifest: undefined }),
      error: /no compiler manifest/iu,
    },
    {
      name: 'Solid compiler ABI is incompatible',
      invalid: snapshot => ({
        ...snapshot,
        nativeManifest: {
          schemaVersion: 1,
          renderer: 'solid',
          compilerVersion: '0.0.0',
          rendererIdentity: identity,
          modules: {},
        },
      }),
      error: /compiler ABI mismatch/iu,
    },
    {
      name: 'assets contain no application script',
      invalid: snapshot => ({
        ...snapshot,
        assets: [{ kind: 'stylesheet', href: '/compiled/style.css' }],
      }),
      error: /no application script/iu,
    },
    {
      name: 'script asset has an invalid URL',
      invalid: snapshot => ({
        ...snapshot,
        assets: [{ kind: 'script', href: 'javascript:alert(1)' }],
      }),
      error: /HTTP URL/iu,
    },
  ];
  it.each(invalidSnapshots)('rejects $name before the handler runs', async ({
    invalid,
    error,
  }) => {
    const handler = rstest.fn(() => new Response('handler must not execute'));
    const snapshot = invalid(solidSnapshot(identity, 'first', handler));
    const render = await installedRender(providerOptions(async () => snapshot));
    await expect(
      render(new Request('http://native.invalid/'), requestOptions()),
    ).rejects.toThrow(error);
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([
    'missing',
    'mismatched',
  ])('rejects an Octane %s hydration hash before the handler runs', async kind => {
    const octaneIdentity: RendererIdentity = {
      ...identity,
      renderer: 'octane',
    };
    const handler = rstest.fn(() => new Response('handler must not execute'));
    const snapshot = octaneSnapshot(octaneIdentity, handler);
    const { hydrationBuildId: _hash, ...withoutHash } = snapshot;
    const invalid =
      kind === 'missing'
        ? withoutHash
        : { ...snapshot, hydrationBuildId: 'other-compiled-client' };
    const render = await installedRender({
      renderer: 'octane',
      entries: { main: octaneIdentity },
      resolveDevelopmentSnapshot: async () => invalid,
    });
    await expect(
      render(new Request('http://native.invalid/'), requestOptions()),
    ).rejects.toThrow(
      kind === 'missing'
        ? /no native hydration build/iu
        : /differs from the compiled client/iu,
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('interrupts unresolved compiler readiness promptly when the request aborts', async () => {
    const ready = deferred<NativeDevelopmentSnapshot>();
    const entered = deferred<AbortSignal>();
    const handler = rstest.fn(() => new Response('handler must not execute'));
    const provider = rstest.fn(
      async (_entry: RendererIdentity, signal: AbortSignal) => {
        entered.resolve(signal);
        return ready.promise;
      },
    );
    const render = await installedRender(providerOptions(provider));
    const controller = new AbortController();
    const request = new Request('http://native.invalid/', {
      signal: controller.signal,
    });
    const pending = render(request, requestOptions());
    const settled = pending.then(
      () => 'handler completed',
      error => error,
    );
    expect(await entered.promise).toBe(request.signal);
    const reason = new Error('Compiler readiness cancelled');
    controller.abort(reason);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        settled,
        new Promise(resolve => {
          timer = setTimeout(() => resolve('still waiting for compiler'), 500);
        }),
      ]);
      expect(result).toBe(reason);
      expect(handler).not.toHaveBeenCalled();
    } finally {
      clearTimeout(timer);
      ready.resolve(solidSnapshot(identity, 'first', handler));
      await settled;
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it('keeps each entry bound to its own completed compiler snapshot', async () => {
    const adminIdentity: RendererIdentity = { ...identity, entryName: 'admin' };
    const main = solidSnapshot(identity, 'main-build');
    const admin = solidSnapshot(adminIdentity, 'admin-build');
    const provider = rstest.fn(async (entry: RendererIdentity) => {
      if (entry.entryName === 'main') return main;
      if (entry.entryName === 'admin') return admin;
      throw new Error('Unknown development entry.');
    });
    const render = await installedRender({
      renderer: 'solid',
      entries: { main: identity, admin: adminIdentity },
      resolveDevelopmentSnapshot: provider,
    });
    const [mainResponse, adminResponse] = await Promise.all([
      render(new Request('http://native.invalid/'), requestOptions('main')),
      render(
        new Request('http://native.invalid/admin'),
        requestOptions('admin'),
      ),
    ]);
    expect(await mainResponse.json()).toEqual({
      generation: 'main-build',
      entryName: 'main',
      assets: main.assets,
    });
    expect(await adminResponse.json()).toEqual({
      generation: 'admin-build',
      entryName: 'admin',
      assets: admin.assets,
    });
    expect(provider.mock.calls.map(([entry]) => entry.entryName)).toEqual([
      'main',
      'admin',
    ]);
  });
});
