import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { appTools, type RuntimePluginConfig } from '@modern-js/app-tools';
import { createPluginManager } from '@modern-js/plugin';
import {
  createContext,
  initAppContext,
  initPluginAPI,
} from '@modern-js/plugin/cli';
import {
  defineConfig,
  presetUltramodern,
  resolveUltramodernConfig,
  ultramodernAppTools,
} from '@modern-js/ultramodern-app-tools';
import { createRsbuild, rspack } from '@rsbuild/core';
import { runtimeRegister } from '../../../../runtime/plugin-runtime/src/cli/template';

async function initializeCliPlugins(createPlugin: typeof appTools) {
  const appDirectory = path.resolve(__dirname, '../..');
  const consumerConfig = {
    html: { title: 'Consumer title' },
    output: { assetPrefix: '/consumer-assets/' },
  };
  const userConfig =
    createPlugin === ultramodernAppTools
      ? await resolveUltramodernConfig(defineConfig(consumerConfig), {
          env: 'production',
          command: 'build',
        })
      : { ...consumerConfig, plugins: [createPlugin()] };
  const originalConfig = {
    ...structuredClone(consumerConfig),
    ...('renderer' in userConfig ? { renderer: userConfig.renderer } : {}),
    plugins: [...(userConfig.plugins ?? [])],
  };
  const pluginManager = createPluginManager();
  pluginManager.addPlugins(userConfig.plugins ?? []);
  const plugins = pluginManager.getPlugins();
  const context = await createContext({
    appContext: initAppContext({
      packageName: 'consumer-app',
      configFile: false,
      command: 'build',
      appDirectory,
      metaName: 'modern-js',
      plugins,
    }),
    config: userConfig,
    normalizedConfig: userConfig,
  });
  const api = initPluginAPI({ context, pluginManager });
  context.pluginAPI = api;
  for (const plugin of plugins) await plugin.setup?.(api);
  return { api, appDirectory, userConfig, originalConfig };
}

async function evaluateRuntimeRegistration(
  fixtureRoot: string,
  platform: 'browser' | 'node',
  runtimePlugins: RuntimePluginConfig[],
) {
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
      modules: [path.resolve(__dirname, '../../node_modules'), 'node_modules'],
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
  it.each([
    {
      name: 'UltraModern',
      createPlugin: ultramodernAppTools,
      rendererCount: 1,
    },
    // The fork's renderer policy is the default for a plain `appTools()` app,
    // and composing `ultramodernAppTools()` must not register it twice.
    { name: 'native appTools', createPlugin: appTools, rendererCount: 1 },
  ])('$name preserves consumer configuration and registers its renderer per entrypoint', async ({
    createPlugin,
    rendererCount,
  }) => {
    const { api, appDirectory, userConfig, originalConfig } =
      await initializeCliPlugins(createPlugin);

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
        expect(result.plugins).toEqual([consumerPlugin]);
      }
    }

    expect(api.getConfig()).toBe(userConfig);
    expect(api.getConfig()).toEqual(originalConfig);
    expect(api.getNormalizedConfig()).toEqual(originalConfig);
  });

  it.each([
    'browser',
    'node',
  ] as const)('executes generated %s registration through the public renderer entry and preserves consumer hooks', async platform => {
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
  });

  it.each([
    { precompress: false, expected: 0 },
    { precompress: { gzip: false, brotli: { threshold: 42 } }, expected: 1 },
    { precompress: undefined, expected: 2 },
  ])('uses merged precompression options and preserves consumer plugins: $expected', async ({
    precompress,
    expected,
  }) => {
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
  });
});
