import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from '@rstest/core';
import { resolveRendererFederationCompatibility } from '../../src/native-composition/module-federation-renderer-plugin';
import {
  createNativeClientFederationOptions,
  createNativeServerFederationOptions,
  createNativeSharedConfig,
  findNativeFederationConfig,
  loadNativeFederationConfig,
  NATIVE_FEDERATION_HYDRATION_MODULE,
  nativeFederationRuntimePluginSource,
  nativeModuleFederationPlugin,
  readNativeFederationRemotes,
  resolveNativeSharedVersions,
  sharedPackageName,
  withNativeServerContainer,
} from '../../src/native-composition/native-module-federation';
import { assertCapturedRenderer } from '../../src/native-composition/renderer-selection';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

function app(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-mf-'));
  roots.push(root);
  for (const [file, content] of Object.entries(files))
    fs.writeFileSync(path.join(root, file), content);
  return root;
}

const manifestRemote = 'remote@https://remote.example/mf-manifest.json';

describe('native Module Federation configuration', () => {
  it('finds exactly one module-federation config file', () => {
    expect(findNativeFederationConfig(app({}))).toBeUndefined();
    const root = app({ 'module-federation.config.ts': 'export default {}' });
    expect(findNativeFederationConfig(root)).toBe(
      path.join(root, 'module-federation.config.ts'),
    );
    expect(() =>
      findNativeFederationConfig(
        app({
          'module-federation.config.ts': '',
          'module-federation.config.mjs': '',
        }),
      ),
    ).toThrow('choose one configuration file');
  });

  it('loads TypeScript options and rejects renderer-owned options', async () => {
    const root = app({
      'module-federation.config.ts': `const name: string = 'host';
export default { name, remotes: { remote: '${manifestRemote}' } };`,
      'owned.mjs': `export default { name: 'host', library: { type: 'var' } };`,
      'startup.mjs': `export default { name: 'host', experiments: { asyncStartup: false } };`,
      'nameless.mjs': 'export default {};',
      'direct.mjs': `export default { name: 'host', remotes: { remote: 'remote@https://remote.example/remoteEntry.js' } };`,
    });
    await expect(
      loadNativeFederationConfig(
        path.join(root, 'module-federation.config.ts'),
      ),
    ).resolves.toEqual({ name: 'host', remotes: { remote: manifestRemote } });
    await expect(
      loadNativeFederationConfig(path.join(root, 'owned.mjs')),
    ).rejects.toThrow('library is owned by the native renderer');
    await expect(
      loadNativeFederationConfig(path.join(root, 'startup.mjs')),
    ).rejects.toThrow('asyncStartup is owned');
    await expect(
      loadNativeFederationConfig(path.join(root, 'nameless.mjs')),
    ).rejects.toThrow('container name');
    await expect(
      loadNativeFederationConfig(path.join(root, 'direct.mjs')),
    ).rejects.toThrow('must name its native manifest');
  });

  it('reads manifest remotes in record, object and array form', () => {
    expect(
      readNativeFederationRemotes({
        remotes: {
          remote: manifestRemote,
          catalog: { name: 'catalog', entry: '/catalog/mf-manifest.json' },
        },
      }),
    ).toEqual({
      remote: manifestRemote,
      catalog: 'catalog@/catalog/mf-manifest.json',
    });
    expect(readNativeFederationRemotes({ remotes: [manifestRemote] })).toEqual({
      remote: manifestRemote,
    });
  });

  const versions = () =>
    // This package installs the Solid renderer as a development dependency.
    resolveNativeSharedVersions('solid', path.resolve(__dirname, '../..'));

  it('pins renderer singletons to installed versions, not manifest ranges', () => {
    expect(sharedPackageName('@modern-js/renderer-core/')).toBe(
      '@modern-js/renderer-core',
    );
    expect(sharedPackageName('solid-js')).toBe('solid-js');
    const installed = versions();
    expect(installed['solid-js']).toBe('2.0.0-rc.13');
    expect(installed['@modern-js/renderer-core/']).toMatch(/^\d+\.\d+\.\d+/u);
    expect(() => resolveNativeSharedVersions('solid', os.tmpdir())).toThrow(
      'cannot find the installed',
    );
  });

  it('owns the Solid runtime singletons and keeps authored shares', () => {
    const shared = createNativeSharedConfig(
      'solid',
      { lodash: {} },
      versions(),
    );
    expect(shared.lodash).toEqual({});
    expect(shared['solid-js']).toEqual({
      singleton: true,
      strictVersion: true,
      requiredVersion: '2.0.0-rc.13',
      eager: false,
    });
    expect(() =>
      createNativeSharedConfig(
        'solid',
        { 'solid-js': { singleton: false } },
        versions(),
      ),
    ).toThrow('solid-js is a solid runtime singleton');
  });

  it('publishes an ESM container with its own runtime and a bootstrap startup', () => {
    const options = createNativeClientFederationOptions(
      'solid',
      { name: 'remote', exposes: { './Widget': './src/Widget.tsx' } },
      versions(),
    );
    expect(options).toMatchObject({
      name: 'remote',
      filename: 'remoteEntry.js',
      library: { type: 'module' },
      runtime: false,
      shareStrategy: 'loaded-first',
      manifest: true,
      dts: false,
      experiments: { asyncStartup: false },
    });
  });

  it('publishes a Node container whose shares wait for the host scope', () => {
    const options = createNativeServerFederationOptions(
      'solid',
      {
        name: 'remote',
        exposes: { './Widget': './src/Widget.tsx' },
        remotes: { other: manifestRemote },
      },
      versions(),
      ['/node/runtimePlugin.js', '/generated/native-runtime.server.mjs'],
    );
    expect(options).toMatchObject({
      name: 'remote',
      filename: 'remoteEntry.js',
      library: { type: 'commonjs-module', name: 'remote' },
      remoteType: 'script',
      shareStrategy: 'loaded-first',
      manifest: true,
      dts: false,
      runtimePlugins: [
        '/node/runtimePlugin.js',
        '/generated/native-runtime.server.mjs',
      ],
      experiments: { asyncStartup: false, optimization: { target: 'node' } },
    });
    expect(options.remotes).toBeUndefined();
    expect((options.shared as Record<string, any>)['solid-js']).toMatchObject({
      singleton: true,
      eager: false,
    });
  });

  it('names the server container in the browser manifest', async () => {
    const manifest = withNativeServerContainer(
      {
        additionalData: ({ stats }: { stats: any }) => ({
          ...stats,
          authored: true,
        }),
      },
      'bundles',
      'remoteEntry.js',
    );
    const stats = await (manifest.additionalData as any)({
      stats: { metaData: { publicPath: 'https://remote.example/' } },
    });
    expect(stats).toEqual({
      authored: true,
      metaData: {
        publicPath: 'https://remote.example/',
        ssrPublicPath: 'https://remote.example/bundles/',
        ssrRemoteEntry: {
          name: 'remoteEntry.js',
          path: '',
          type: 'commonjs-module',
        },
      },
    });
    expect(() => withNativeServerContainer(false, 'bundles', 'r.js')).toThrow(
      'native manifest publication',
    );
    const client = createNativeClientFederationOptions(
      'solid',
      { name: 'remote', exposes: { './Widget': './src/Widget.tsx' } },
      versions(),
      undefined,
      'bundles',
    );
    expect(typeof (client.manifest as any).additionalData).toBe('function');
  });

  it('publishes the server federation state from the host instance only', async () => {
    const root = app({});
    const file = path.join(root, 'runtime.mjs');
    fs.writeFileSync(
      file,
      nativeFederationRuntimePluginSource([], {
        hydrationModule: NATIVE_FEDERATION_HYDRATION_MODULE,
      }),
    );
    const { default: plugin } = await import(pathToFileURL(file).href);
    const host = {};
    const globals = globalThis as Record<symbol, any>;
    try {
      plugin().beforeInit({ origin: host, userOptions: {} });
      plugin().beforeInit({ origin: {}, userOptions: {} });
      expect(globals[Symbol.for('ultramodern.federation.host-instance')]).toBe(
        host,
      );
      const state = globals[Symbol.for('ultramodern.federation.ssr')];
      expect(state.hydrationModule).toMatch(
        /^static\/js\/ultramodern-federation-hydration\.[0-9a-f]{8}\.js$/u,
      );
      expect(state.assets).toBeInstanceOf(Map);
    } finally {
      delete globals[Symbol.for('ultramodern.federation.host-instance')];
      delete globals[Symbol.for('ultramodern.federation.ssr')];
    }
  });
});

describe('native Module Federation plugin', () => {
  type Hook = (...args: any[]) => any;
  function setup(
    renderer: 'solid' | 'octane',
    appDirectory: string,
    config: Record<string, unknown> = {},
  ) {
    const hooks: Record<string, Hook> = {};
    const internalDirectory = path.join(
      appDirectory,
      'node_modules/.modern-js',
    );
    const api = new Proxy(
      {
        getAppContext: () => ({ appDirectory, internalDirectory }),
        getNormalizedConfig: () => config,
      },
      {
        get: (target, key: string) =>
          key in target
            ? target[key as keyof typeof target]
            : (hook: Hook) => {
                hooks[key] = hook;
              },
      },
    );
    nativeModuleFederationPlugin(renderer).setup!(api as never);
    return hooks;
  }

  function chain(entries: Record<string, string[]> = {}) {
    const uses: unknown[][] = [];
    const entry = (name: string) => ({
      values: () => entries[name],
      clear: () => {
        entries[name] = [];
      },
      add: (value: string) => entries[name].push(value),
    });
    return {
      uses,
      entries,
      chain: {
        plugin: (key: string) => ({
          use: (Plugin: unknown, args: unknown[]) =>
            uses.push([key, Plugin, args]),
        }),
        target: (value: string) => uses.push(['target', value]),
        entryPoints: { entries: () => ({ ...entries }) },
        entry,
      },
    };
  }

  function installPackages(root: string, node = false) {
    const enhanced = path.join(
      root,
      'node_modules/@module-federation/enhanced',
    );
    fs.mkdirSync(enhanced, { recursive: true });
    fs.writeFileSync(
      path.join(enhanced, 'package.json'),
      JSON.stringify({
        name: '@module-federation/enhanced',
        exports: { './rspack': './rspack.cjs' },
      }),
    );
    fs.writeFileSync(
      path.join(enhanced, 'rspack.cjs'),
      'exports.ModuleFederationPlugin = class ModuleFederationPlugin {};',
    );
    if (node) {
      const directory = path.join(root, 'node_modules/@module-federation/node');
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(
        path.join(directory, 'package.json'),
        JSON.stringify({
          name: '@module-federation/node',
          exports: { './runtimePlugin': './runtimePlugin.js' },
        }),
      );
      fs.writeFileSync(path.join(directory, 'runtimePlugin.js'), '');
    }
    fs.mkdirSync(path.join(root, 'node_modules/@modern-js'), {
      recursive: true,
    });
    fs.symlinkSync(
      path.resolve(__dirname, '../../../../runtime/renderer-solid'),
      path.join(root, 'node_modules/@modern-js/renderer-solid'),
    );
  }

  it('installs a Node container on the server compilation of an SSR host', async () => {
    const root = app({
      'package.json': '{}',
      'module-federation.config.mjs': `export default { name: 'host', remotes: { remote: '${manifestRemote}' } };`,
    });
    installPackages(root, true);
    const hooks = setup('solid', root, { server: { ssr: true } });
    const server = chain();
    await hooks.modifyBundlerChain(server.chain, {
      environment: { name: 'server' },
    });
    const [target, [key, , [options]]] = server.uses as [
      unknown,
      [string, unknown, [any]],
    ];
    expect(target).toEqual(['target', 'async-node']);
    expect(key).toBe('plugin-module-federation');
    expect(options.library).toEqual({ type: 'commonjs-module', name: 'host' });
    expect(options.runtimePlugins).toEqual([
      fs.realpathSync(
        path.join(
          root,
          'node_modules/@module-federation/node/runtimePlugin.js',
        ),
      ),
      path.join(
        root,
        'node_modules/.modern-js/federation/native-runtime.server.mjs',
      ),
    ]);
    // The client emits the hydration module the server document names.
    const client = chain();
    await hooks.modifyBundlerChain(client.chain, {
      environment: { name: 'client' },
    });
    expect(client.uses.map(([name]) => name)).toEqual([
      'plugin-module-federation',
      'ultramodern-federation-hydration-module',
    ]);
    // Server assets keep the client public path; the container gets its own.
    const config: any = { output: { publicPath: '/' } };
    await hooks.modifyRspackConfig(config, { environment: { name: 'server' } });
    expect(config.output.publicPath).toBe('/bundles/');
    expect(config.module.generator['asset/resource'].publicPath).toBe('/');
  });

  it('keeps a client-only host off the server compilation', async () => {
    const root = app({
      'package.json': '{}',
      'module-federation.config.mjs': `export default { name: 'host', remotes: { remote: '${manifestRemote}' } };`,
    });
    installPackages(root);
    const hooks = setup('solid', root, { server: { ssr: false } });
    const server = chain();
    await hooks.modifyBundlerChain(server.chain, {
      environment: { name: 'server' },
    });
    expect(server.uses).toEqual([]);
  });

  it('requires @module-federation/node for server containers', async () => {
    const root = app({
      'package.json': '{}',
      'module-federation.config.mjs': `export default { name: 'remote', exposes: { './Widget': './Widget.tsx' } };`,
    });
    installPackages(root);
    const hooks = setup('solid', root);
    await expect(
      hooks.modifyBundlerChain(chain().chain, {
        environment: { name: 'server' },
      }),
    ).rejects.toThrow('install @module-federation/node');
  });

  it('installs the client container and starts entries through a bootstrap', async () => {
    const root = app({
      'package.json': '{}',
      'module-federation.config.mjs': `export default { name: 'host', remotes: { remote: '${manifestRemote}' } };`,
    });
    installPackages(root);
    const generated = path.join(
      root,
      'node_modules/.modern-js/solid/index/index.ts',
    );
    fs.mkdirSync(path.dirname(generated), { recursive: true });
    const hooks = setup('solid', root);
    const client = chain({ index: ['core-js/polyfill', generated] });
    await hooks.modifyBundlerChain(client.chain, {
      environment: { name: 'client' },
    });
    const [[key, Plugin, [options]]] = client.uses as [[string, any, [any]]];
    expect(key).toBe('plugin-module-federation');
    expect(Plugin.name).toBe('ModuleFederationPlugin');
    expect(options).toMatchObject({
      name: 'host',
      library: { type: 'module' },
    });
    // Remotes register at runtime through the generated runtime plugin.
    expect(options.remotes).toBeUndefined();
    const runtimePlugin = path.join(
      root,
      'node_modules/.modern-js/federation/native-runtime.mjs',
    );
    expect(options.runtimePlugins).toEqual([runtimePlugin]);
    const { default: plugin } = await import(
      `${pathToFileURL(runtimePlugin).href}?test`
    );
    const origin = {};
    const args = plugin().beforeInit({
      origin,
      userOptions: {
        remotes: [
          { name: 'other', alias: 'other', entry: '/other/mf-manifest.json' },
        ],
      },
    });
    expect(args.userOptions.remotes).toEqual([
      { name: 'other', alias: 'other', entry: '/other/mf-manifest.json' },
      {
        name: 'remote',
        alias: 'remote',
        entry: 'https://remote.example/mf-manifest.json',
      },
    ]);
    expect(
      (globalThis as Record<symbol, unknown>)[
        Symbol.for('ultramodern.federation.host-instance')
      ],
    ).toBe(origin);
    delete (globalThis as Record<symbol, unknown>)[
      Symbol.for('ultramodern.federation.host-instance')
    ];
    const bootstrap = path.join(path.dirname(generated), 'index.federation.js');
    expect(client.entries.index).toEqual(['core-js/polyfill', bootstrap]);
    expect(fs.readFileSync(bootstrap, 'utf8')).toBe(
      `import(${JSON.stringify(generated)});\n`,
    );
  });

  it('is inert without a configuration file', async () => {
    const hooks = setup('solid', app({}));
    const client = chain();
    await hooks.modifyBundlerChain(client.chain, {
      environment: { name: 'client' },
    });
    expect(client.uses).toEqual([]);
  });

  it('rejects a renderer without the federation capability', async () => {
    const hooks = setup(
      'octane',
      app({ 'module-federation.config.mjs': 'export default { name: "x" }' }),
    );
    await expect(
      hooks.modifyBundlerChain(chain().chain, {
        environment: { name: 'client' },
      }),
    ).rejects.toThrow(
      'unsupported-renderer-capability: renderer octane does not support Module Federation',
    );
  });

  it('requires the application to install @module-federation/enhanced', async () => {
    const hooks = setup(
      'solid',
      app({
        'package.json': '{}',
        'module-federation.config.mjs': 'export default { name: "x" }',
      }),
    );
    await expect(
      hooks.modifyBundlerChain(chain().chain, {
        environment: { name: 'client' },
      }),
    ).rejects.toThrow('install @module-federation/enhanced');
  });
});

describe('native renderer federation identity', () => {
  it('resolves the Solid tuple from the installed renderer owners', () => {
    const compatibility = resolveRendererFederationCompatibility('solid');
    expect(compatibility.profile.renderer).toBe('solid');
    expect(compatibility.runtime.name).toBe('solid-js');
    expect(compatibility.bootstrap.name).toBe('@modern-js/renderer-solid');
    expect(compatibility.profile.hydration.name).toBe('@solidjs/web');
  });

  it('keeps Module Federation application SSR React-only', () => {
    expect(() =>
      assertCapturedRenderer(
        {
          renderer: 'solid',
          server: { ssr: { moduleFederationAppSSR: true } },
        } as never,
        'solid',
      ),
    ).toThrow('does not support Module Federation application SSR');
  });
});
