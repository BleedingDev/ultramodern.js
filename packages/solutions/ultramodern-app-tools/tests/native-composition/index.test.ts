import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {
  type AppTools,
  appTools,
  type RuntimePluginConfig,
} from '@modern-js/app-tools';
import type { PolicyDefaultsOptions } from '@modern-js/app-tools-extensions/policy-defaults';
import type { CLIPluginAPI } from '@modern-js/plugin';
import { createCli, createConfigOptions } from '@modern-js/plugin/cli';
import {
  presetUltramodern,
  ultramodernAppTools,
} from '@modern-js/ultramodern-app-tools';
import { createRsbuild, rspack } from '@rsbuild/core';
import { runtimeRegister } from '../../../../runtime/plugin-runtime/src/cli/template';
import { RENDERER_BUILD_MANIFEST_FILE } from '../../src/native-composition/native-build-manifest';
import { resolveRendererProfile } from '../../src/native-composition/renderer-profile';

const packageDirectory = path.resolve(__dirname, '../..');
const consumerApps: string[] = [];
afterAll(() => {
  for (const directory of consumerApps.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

/**
 * An authored UltraModern application resolves its server plugin through its
 * own declared dependency, so it initializes in an isolated consumer that
 * depends on this package.
 */
function createConsumerApp() {
  const appDirectory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'um-native-composition-')),
  );
  consumerApps.push(appDirectory);
  const scope = path.join(appDirectory, 'node_modules/@modern-js');
  fs.mkdirSync(scope, { recursive: true });
  fs.symlinkSync(
    packageDirectory,
    path.join(scope, 'ultramodern-app-tools'),
    'dir',
  );
  fs.writeFileSync(
    path.join(appDirectory, 'package.json'),
    JSON.stringify({
      name: 'native-composition-consumer',
      private: true,
      dependencies: { '@modern-js/ultramodern-app-tools': 'workspace:*' },
    }),
  );
  fs.mkdirSync(path.join(appDirectory, 'src'));
  fs.writeFileSync(
    path.join(appDirectory, 'src/App.jsx'),
    'export default function App() { return <main>composition</main>; }',
  );
  return appDirectory;
}

async function initializeCliPlugins(
  createPlugin: typeof appTools,
  options?: PolicyDefaultsOptions,
) {
  const userConfig = {
    html: { title: 'Consumer title' },
    output: { assetPrefix: '/consumer-assets/' },
  };
  // Applications author the UltraModern base composition in config.plugins;
  // a plain appTools() base registers as an internal plugin.
  const basePlugin = createPlugin(options);
  const authored = createPlugin === ultramodernAppTools;
  const originalConfig = authored
    ? { ...structuredClone(userConfig), plugins: [basePlugin] }
    : structuredClone(userConfig);
  let api: CLIPluginAPI<AppTools> | undefined;
  const observer = {
    name: 'consumer-config-observer',
    setup(pluginApi: CLIPluginAPI<AppTools>) {
      api = pluginApi;
    },
  };
  if (authored) {
    const authoredConfig = { ...userConfig, plugins: [basePlugin] };
    const appDirectory = createConsumerApp();
    const cli = createCli<AppTools>();
    try {
      const { appContext } = await cli.init({
        internalPlugins: [observer],
        configFile: false,
        command: 'build',
        cwd: appDirectory,
        metaName: 'modern-js',
        config: authoredConfig,
      });
      if (!api)
        throw new Error('Consumer config observer was not initialized.');
      const plugins = appContext.plugins;
      return {
        api,
        appDirectory,
        userConfig: authoredConfig,
        originalConfig,
        plugins,
      };
    } finally {
      cli.dispose();
    }
  }
  const appDirectory = packageDirectory;
  const result = await createConfigOptions<AppTools>({
    command: 'build',
    configFile: false,
    cwd: appDirectory,
    config: userConfig,
    internalPlugins: [basePlugin, observer],
  });
  if (!api) throw new Error('Consumer config observer was not initialized.');
  const plugins = result.getAppContext().plugins;
  return { api, appDirectory, userConfig, originalConfig, plugins };
}

const REACT_IDENTITY_SERVER_PLUGIN =
  /renderers[\\/]react[\\/]build-metadata-server(?:\.[cm]?js)?$/u;

/**
 * UltraModern composes the React renderer's server identity plugin, which
 * requires resolved build identities. Serve a saved React renderer build so
 * server-policy composition is observed against real identities.
 */
async function withSavedReactBuild<T>(
  api: CLIPluginAPI<AppTools>,
  entryNames: readonly string[],
  run: (entries: Record<string, unknown>) => Promise<T>,
): Promise<T> {
  const { command, distDirectory } = api.getAppContext();
  const savedDist = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-composition-dist-'),
  );
  const buildMarker = 'a'.repeat(64);
  const profile = resolveRendererProfile('react');
  const entries = Object.fromEntries(
    entryNames.map(entryName => [
      entryName,
      {
        renderer: 'react' as const,
        appId: 'native-composition-proof',
        entryName,
        protocolVersion: 1 as const,
        buildId: buildMarker,
      },
    ]),
  );
  const provider = { ...profile.router, framework: 'react-router' as const };
  fs.writeFileSync(
    path.join(savedDist, RENDERER_BUILD_MANIFEST_FILE),
    JSON.stringify({
      schema: 'ultramodern-renderer-build',
      version: 2,
      renderer: 'react',
      profile,
      entries,
      buildId: buildMarker,
      sourceRevision: 'workspace',
      routerBindings: Object.fromEntries(
        entryNames.map(entryName => [
          entryName,
          {
            owner: '@modern-js/plugin-router',
            evidence: 'owned-default',
            defaultProvider: { ...provider },
            providers: [{ ...provider }],
          },
        ]),
      ),
    }),
  );
  api.updateAppContext({ command: 'serve', distDirectory: savedDist });
  try {
    return await run(entries);
  } finally {
    api.updateAppContext({ command, distDirectory });
    fs.rmSync(savedDist, { recursive: true, force: true });
  }
}

async function evaluateRuntimeRegistration(
  fixtureRoot: string,
  platform: 'browser' | 'node',
  runtimePlugins: RuntimePluginConfig[],
) {
  const consumerPackageScope = path.join(
    fixtureRoot,
    'node_modules/@modern-js',
  );
  fs.mkdirSync(consumerPackageScope, { recursive: true });
  fs.symlinkSync(
    packageDirectory,
    path.join(consumerPackageScope, 'ultramodern-app-tools'),
    'dir',
  );
  fs.writeFileSync(
    path.join(fixtureRoot, 'package.json'),
    JSON.stringify({
      name: 'runtime-registration-consumer',
      private: true,
      dependencies: { '@modern-js/ultramodern-app-tools': 'workspace:*' },
    }),
  );
  const runtimeDirectory = path.resolve(
    __dirname,
    '../../../../runtime/plugin-runtime',
  );
  fs.writeFileSync(
    path.join(fixtureRoot, 'entry-context.js'),
    `import { setGlobalContext } from '@modern-js/runtime/context';
setGlobalContext({ entryName: 'main' });`,
  );
  fs.writeFileSync(
    path.join(fixtureRoot, 'runtime.js'),
    `export default entryName => ({
  consumer: { entryName, override: 'runtime', nested: { runtime: true } },
  userSetting: 'preserved',
});`,
  );
  fs.writeFileSync(
    path.join(fixtureRoot, 'consumer-runtime.js'),
    `export const consumerPlugin = options => ({
  name: 'consumer-runtime',
  setup(api) {
    function ConsumerWidget() { return null; }
    api.resolveComponent((component, { name }) =>
      name === 'consumer.Widget' ? ConsumerWidget : component);
    api.config(() => ({ consumerMerged: options }));
  },
});`,
  );
  fs.writeFileSync(
    path.join(fixtureRoot, 'registration.js'),
    `import './entry-context.js';
${runtimeRegister({
  entryName: 'main',
  srcDirectory: fixtureRoot,
  internalSrcAlias: '@fixture/src',
  metaName: 'modern-js',
  runtimeConfigFile: 'runtime',
  runtimePlugins,
})}
import { getGlobalInternalRuntimeContext } from '@modern-js/runtime/context';
const context = getGlobalInternalRuntimeContext();
const fallback = () => null;
const resolve = name => context.hooks.resolveComponent.call(fallback, { name });
const collectors = context.hooks.extendStringSSRCollectors.call({ render: { runtimeContext: {} } });
const streams = context.hooks.extendStreamSSR.call({
  platform: ${JSON.stringify(platform === 'node' ? 'node' : 'web')},
  runtimeContext: {},
  terminalMarker: 'registration-acceptance-end',
});
export const acceptance = {
  headResolved: resolve('head.Helmet') !== fallback,
  consumerResolved: resolve('consumer.Widget').name === 'ConsumerWidget',
  unknownPreserved: resolve('unknown.Component') === fallback,
  config: context.config,
  collectors: collectors.length,
  streams: streams.map(stream => ({
    node: typeof stream.processStream === 'function',
    web: typeof stream.processReadableStream === 'function',
  })),
};`,
  );
  const outputDirectory = path.join(fixtureRoot, 'dist');
  const compiler = rspack.rspack({
    context: fixtureRoot,
    entry: './registration.js',
    mode: 'production',
    target: platform === 'node' ? 'node' : 'web',
    devtool: false,
    optimization: { minimize: false },
    output: {
      path: outputDirectory,
      filename: 'registration.cjs',
      library: { type: 'commonjs2' },
    },
    resolve: {
      extensions: ['.tsx', '.ts', '.mjs', '.js', '.json'],
      conditionNames: ['modern:source', platform, 'import', 'default'],
      modules: ['node_modules', path.join(packageDirectory, 'node_modules')],
      alias: {
        '@fixture/src': fixtureRoot,
        '@modern-js/runtime/plugin$': path.join(
          runtimeDirectory,
          'src/core/plugin/index.ts',
        ),
        '@modern-js/runtime/context$': path.join(
          runtimeDirectory,
          'src/core/context/index.ts',
        ),
      },
    },
    module: {
      parser: { javascript: { importExportsPresence: 'error' } },
      rules: [
        {
          test: /\.[cm]?[jt]sx?$/u,
          exclude: /node_modules/u,
          loader: 'builtin:swc-loader',
          options: {
            jsc: {
              parser: { syntax: 'typescript', tsx: true },
              transform: { react: { runtime: 'automatic' } },
            },
          },
        },
      ],
    },
  });
  try {
    await new Promise<void>((resolve, reject) => {
      compiler.run((error, stats) => {
        if (error) reject(error);
        else if (!stats || stats.hasErrors()) {
          reject(
            new Error(
              stats?.toString({ all: false, errors: true }) ??
                'Missing Rspack stats',
            ),
          );
        } else resolve();
      });
    });
    const require = createRequire(import.meta.url);
    const outputPath = path.join(outputDirectory, 'registration.cjs');
    try {
      return require(outputPath).acceptance;
    } finally {
      delete require.cache[outputPath];
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      compiler.close(error => (error ? reject(error) : resolve())),
    );
  }
}

describe('native UltraModern composition', () => {
  it.each(
    [
      {
        name: 'UltraModern',
        createPlugin: ultramodernAppTools,
        serverPluginName: '@modern-js/ultramodern-app-tools/server-plugin',
      },
      // The fork's renderer policy is the default for a plain `appTools()` app,
      // and composing `ultramodernAppTools()` must not register it twice.
      {
        name: 'native appTools',
        createPlugin: appTools,
        serverPluginName: '@modern-js/app-tools/server-plugin',
      },
    ].flatMap(composition =>
      [
        { policies: 'defaults', options: {}, rendererCount: 1, serverCount: 1 },
        {
          policies: 'renderer disabled',
          options: { rendererExtensions: false },
          rendererCount: 0,
          serverCount: 1,
        },
        {
          policies: 'server disabled',
          options: { serverExtensions: false },
          rendererCount: 1,
          serverCount: 0,
        },
        {
          policies: 'both disabled',
          options: { rendererExtensions: false, serverExtensions: false },
          rendererCount: 0,
          serverCount: 0,
        },
      ].map(policy => ({ ...composition, ...policy })),
    ),
  )(
    '$name with $policies preserves consumer configuration and registers policy once',
    async ({
      createPlugin,
      options,
      rendererCount,
      serverCount,
      serverPluginName,
    }) => {
      const { api, appDirectory, userConfig, originalConfig } =
        await initializeCliPlugins(createPlugin, options);

      for (const entryName of ['main', 'admin']) {
        const entrypoint = {
          entryName,
          entry: path.join(appDirectory, 'src', entryName, 'index.tsx'),
        };
        const consumerPlugin = {
          name: `consumer-${entryName}`,
          path: './consumer-runtime',
          config: { entryName, nested: { enabled: true } },
        };
        const originalConsumer = structuredClone(consumerPlugin);
        const result = await api.getHooks()._internalRuntimePlugins.call({
          entrypoint,
          plugins: [consumerPlugin],
        });

        expect(result.entrypoint).toBe(entrypoint);
        expect(result.plugins).toContain(consumerPlugin);
        expect(consumerPlugin).toEqual(originalConsumer);
        const renderers = result.plugins.filter(
          plugin => plugin.name === 'rendererHead',
        );
        expect(renderers).toHaveLength(rendererCount);
        if (rendererCount) {
          expect(renderers).toEqual([
            {
              name: 'rendererHead',
              path: '@modern-js/runtime-renderer-extensions',
              config: {},
            },
          ]);
        } else {
          expect(result.plugins).toEqual([
            consumerPlugin,
            ...(createPlugin === ultramodernAppTools
              ? [
                  {
                    name: 'routerState',
                    path: '@modern-js/ultramodern-app-tools/router-state-runtime',
                    config: {},
                  },
                ]
              : []),
          ]);
        }
        const repeated = await api
          .getHooks()
          ._internalRuntimePlugins.call(result);
        expect(
          repeated.plugins.filter(plugin => plugin.name === 'rendererHead'),
        ).toHaveLength(rendererCount);
        expect(repeated.plugins).toContain(consumerPlugin);
      }

      const consumerServer = {
        name: './consumer-server',
        options: { consumer: true },
      };
      const originalServer = structuredClone(consumerServer);
      const rendersReact = createPlugin === ultramodernAppTools;
      await withSavedReactBuild(api, ['main', 'admin'], async entries => {
        const serverResult = await api
          .getHooks()
          ._internalServerPlugins.call({ plugins: [consumerServer] });
        const identityPlugins = serverResult.plugins.filter(plugin =>
          REACT_IDENTITY_SERVER_PLUGIN.test(plugin.name),
        );
        expect(identityPlugins).toEqual(
          rendersReact
            ? [{ name: expect.any(String), options: { entries } }]
            : [],
        );
        const policyPlugins = serverResult.plugins.filter(
          plugin => !identityPlugins.includes(plugin),
        );
        expect(serverResult.plugins).toHaveLength(
          1 + serverCount + identityPlugins.length,
        );
        expect(serverResult.plugins[0]).toBe(consumerServer);
        expect(consumerServer).toEqual(originalServer);
        expect(policyPlugins.slice(1)).toEqual(
          serverCount ? [{ name: serverPluginName }] : [],
        );
        // The server policy registers once; the renderer identity plugin
        // fails closed on a duplicate, so recompose only the policy result.
        const recomposed = await api
          .getHooks()
          ._internalServerPlugins.call({ plugins: policyPlugins });
        expect(recomposed.plugins).toHaveLength(serverResult.plugins.length);
        expect(recomposed.plugins).toEqual(
          expect.arrayContaining(serverResult.plugins),
        );
      });

      const consumerBuilder = { name: 'consumer-builder', setup() {} };
      const configInput = {
        ...api.getNormalizedConfig(),
        builderPlugins: [consumerBuilder],
      };
      const configResult = await api
        .getHooks()
        .modifyResolvedConfig.call(configInput);
      expect(configResult.builderPlugins?.[0]).toBe(consumerBuilder);
      expect(configInput.builderPlugins).toEqual([consumerBuilder]);
      expect(
        configResult.builderPlugins?.filter(
          plugin =>
            plugin &&
            'name' in plugin &&
            plugin.name === 'ultramodern:runtime-package-resolution',
        ),
      ).toHaveLength(createPlugin === ultramodernAppTools ? 1 : rendererCount);

      expect(userConfig).toEqual(originalConfig);
      expect(api.getConfig()).toEqual(originalConfig);
      expect(api.getNormalizedConfig()).toMatchObject(originalConfig);
    },
  );

  it.each([
    '@modern-js/app-tools/server-plugin',
    '@modern-js/ultramodern-app-tools/server-plugin',
  ])('preserves a consumer server policy descriptor at %s', async name => {
    const { api, plugins } = await initializeCliPlugins(ultramodernAppTools);
    const descriptor = { name, options: { consumer: true } };
    await withSavedReactBuild(api, ['main'], async entries => {
      const result = await api
        .getHooks()
        ._internalServerPlugins.call({ plugins: [descriptor] });
      expect(result.plugins).toEqual([
        descriptor,
        {
          name: expect.stringMatching(REACT_IDENTITY_SERVER_PLUGIN),
          options: { entries },
        },
      ]);
      // React composition may rewrite the canonical descriptor to the
      // application's portable SDK import; the consumer's values survive.
      expect(result.plugins[0]).toEqual(descriptor);
    });
    expect(descriptor).toEqual({ name, options: { consumer: true } });
    expect(plugins.map(plugin => plugin.name)).toContain(
      '@modern-js/ultramodern-app-tools/policy-defaults',
    );
  });

  it.each(['browser', 'node'] as const)(
    'executes generated %s registration through the public renderer entry and preserves consumer hooks',
    async platform => {
      const fixtureRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'um-runtime-registration-'),
      );
      try {
        const { api } = await initializeCliPlugins(ultramodernAppTools);
        const { plugins } = await api.getHooks()._internalRuntimePlugins.call({
          entrypoint: {
            entryName: 'main',
            entry: path.join(fixtureRoot, 'App.tsx'),
          },
          plugins: [
            {
              name: 'consumer',
              path: './consumer-runtime.js',
              config: { override: 'cli', nested: { cli: true } },
            },
          ],
        });
        const acceptance = await evaluateRuntimeRegistration(
          fixtureRoot,
          platform,
          plugins,
        );
        expect(acceptance).toMatchObject({
          headResolved: true,
          consumerResolved: true,
          unknownPreserved: true,
          config: {
            userSetting: 'preserved',
            consumerMerged: {
              entryName: 'main',
              override: 'runtime',
              nested: { cli: true, runtime: true },
            },
          },
          collectors: 1,
          streams: [{ node: platform === 'node', web: true }],
        });
      } finally {
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
      }
    },
  );

  it.each([
    { precompress: false, expected: 0 },
    { precompress: { gzip: false, brotli: { threshold: 42 } }, expected: 1 },
    { precompress: undefined, expected: 2 },
  ])(
    'uses merged precompression options and preserves consumer plugins: $expected',
    async ({ precompress, expected }) => {
      const calls: string[] = [];
      const consumerPlugin = {
        name: 'consumer-plugin',
        setup() {
          calls.push('consumer');
        },
      };
      const config = presetUltramodern({
        output: { precompress },
        builderPlugins: [consumerPlugin],
      });
      const rsbuild = await createRsbuild({
        rsbuildConfig: {
          mode: 'production',
          plugins: config.builderPlugins,
        },
      });
      const [rspackConfig] = await rsbuild.initConfigs();
      const compression =
        rspackConfig.plugins?.filter(
          plugin => plugin?.constructor.name === 'CompressionPlugin',
        ) ?? [];
      expect(compression).toHaveLength(expected);
      expect(calls).toEqual(['consumer']);
      expect(config.builderPlugins).toContainEqual(consumerPlugin);
    },
  );
});
