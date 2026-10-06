import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type { AppTools, RuntimePluginConfig } from '@modern-js/app-tools';
import { createPluginManager } from '@modern-js/plugin';
import {
  createContext,
  initAppContext,
  initPluginAPI,
} from '@modern-js/plugin/cli';
import { tanstackRouterPlugin } from '@modern-js/plugin-tanstack';
import {
  routerPlugin as nativeRouterCliPlugin,
  runtimePlugin,
} from '@modern-js/runtime/cli';
import {
  defineConfig,
  resolveUltramodernConfig,
} from '@modern-js/ultramodern-app-tools';
import { rspack } from '@rsbuild/core';

const integrationPath = '@modern-js/ultramodern-app-tools/router-runtime';
const stateIntegrationPath =
  '@modern-js/ultramodern-app-tools/router-state-runtime';
const expectedStateDescriptor: RuntimePluginConfig = {
  name: 'routerState',
  path: stateIntegrationPath,
  config: {},
};

async function initializeRouterCli({
  tanstack = false,
  router = {},
}: {
  tanstack?: boolean;
  router?: Record<string, unknown>;
} = {}) {
  const config = await resolveUltramodernConfig(
    defineConfig({
      router,
      plugins: [
        runtimePlugin({ plugins: [nativeRouterCliPlugin()] }),
        ...(tanstack ? [tanstackRouterPlugin()] : []),
      ],
    }),
    { env: 'production', command: 'build' },
  );
  const manager = createPluginManager();
  // Deliberately register the compositor first: its declared ordering must
  // still put its descriptor transform after both framework selectors.
  manager.addPlugins(config.plugins ?? []);
  const plugins = manager.getPlugins();
  const appDirectory = path.resolve(__dirname, '../..');
  const context = await createContext<AppTools>({
    appContext: initAppContext({
      packageName: 'router-integration-consumer',
      configFile: false,
      command: 'build',
      appDirectory,
      metaName: 'modern-js',
      plugins,
    }),
    config,
    normalizedConfig: config,
  });
  const api = initPluginAPI({ context, pluginManager: manager });
  context.pluginAPI = api;
  for (const plugin of plugins) await plugin.setup?.(api);
  api.updateAppContext({
    serverRoutes: [
      { entryName: 'main', urlPath: '/store' },
      { entryName: 'admin', urlPath: '/admin' },
    ],
  });
  return { api, appDirectory, plugins };
}

async function evaluateRouterRuntime(
  descriptor: RuntimePluginConfig,
  stateDescriptor: RuntimePluginConfig,
) {
  const source = `import { ${descriptor.name}Plugin as selectedFactory } from ${JSON.stringify(descriptor.path)};
import { ${stateDescriptor.name}Plugin as stateFactory } from ${JSON.stringify(stateDescriptor.path)};
import { runtime } from '@modern-js/plugin/runtime';
import { getInitialContext } from '@modern-js/runtime/context';
import { routerProviderRegistryHooks } from '@modern-js/runtime/router/internal';
import { getRouterRuntimeState } from '@modern-js/runtime-extensions/router-state';
export async function acceptance() {
  const plugin = selectedFactory(${JSON.stringify(descriptor.config)});
  const statePlugin = stateFactory(${JSON.stringify(stateDescriptor.config)});
  const observations = [];
  const consumer = {
    name: 'consumer-observes-router',
    pre: ['@modern-js/plugin-router'],
    setup(api) {
      api.onAfterCreateRouter(event => {
        observations.push({
          instance: getRouterRuntimeState(event.runtimeContext)?.instance,
          policyInstalled: event.runtimeContext.linkPrefetchPolicy !== undefined,
        });
      });
    },
  };
  const { runtimeContext } = runtime.run({
    config: { router: { framework: 'react-router' } }, plugins: [consumer, plugin, statePlugin],
  });
  const context = getInitialContext(true);
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  try {
    await runtimeContext.hooks.onBeforeRender.call(context);
  } finally {
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
    else Reflect.deleteProperty(globalThis, 'window');
  }
  const instance = { kind: 'native-router-instance' };
  routerProviderRegistryHooks.onAfterCreateRouter.call({
    framework: 'react-router', phase: 'client-create', routes: [],
    runtimeContext: context, router: instance, basename: '/store',
  });
  return {
    canonicalRegistry: plugin.registryHooks === routerProviderRegistryHooks,
    stateCanonicalRegistry: statePlugin.registryHooks === routerProviderRegistryHooks,
    policyInstalled: context.linkPrefetchPolicy !== undefined,
    nativeLinkInstalled: context.router?.Link !== undefined,
    observedNativeInstance: observations.length === 1 && observations[0].instance === instance,
    policyInstalledBeforeConsumer: observations.length === 1 && observations[0].policyInstalled,
    basename: getRouterRuntimeState(context)?.basename,
  };
}`;
  return evaluateRuntimeExport(source);
}

async function evaluateRouterStateRuntime(descriptor: RuntimePluginConfig) {
  const source = `import { ${descriptor.name}Plugin as stateFactory } from ${JSON.stringify(descriptor.path)};
import { runtime } from '@modern-js/plugin/runtime';
import { getInitialContext, routerProviderRegistryHooks } from '@modern-js/runtime/context';
import { applyRouterServerPrepareResult } from '@modern-js/runtime-extensions/router-state';
export async function acceptance() {
  const statePlugin = stateFactory(${JSON.stringify(descriptor.config)});
  const failure = new Error('custom router loader failed');
  const nativeFailure = new Error('native fallback loader failed');
  let cleanupCalls = 0;
  let policyInstalledBeforePreparation = false;
  let context;
  const observations = [];
  const provider = {
    name: '@modern-js/plugin-tanstack',
    setup(api) {
      api.onBeforeRender(runtimeContext => {
        policyInstalledBeforePreparation = runtimeContext.linkPrefetchPolicy !== undefined;
        applyRouterServerPrepareResult(runtimeContext, {
          state: { framework: 'custom-router' },
          snapshot: { framework: 'custom-router', statusCode: 418, errors: { route: failure } },
          cleanup: () => { cleanupCalls += 1; },
        });
      });
    },
  };
  const consumer = {
    name: 'consumer-observes-custom-router',
    pre: ['@modern-js/router-runtime-policy'],
    setup(api) {
      api.onRenderPrepared(info => {
        observations.push(info.routerResult?.statusCode === 418 && info.routerResult?.errors?.route === failure);
        return info;
      });
      api.onRequestEnd(info => {
        observations.push(info.runtimeContext === context && info.terminal.status === 'complete');
      });
    },
  };
  const { runtimeContext } = runtime.run({
    config: { router: { framework: 'custom-router' } }, plugins: [consumer, provider, statePlugin],
  });
  context = getInitialContext(false);
  context.routerContext = { statusCode: 404, errors: { native: nativeFailure } };
  await runtimeContext.hooks.onBeforeRender.call(context);
  const prepared = await runtimeContext.hooks.onRenderPrepared.call({
    runtimeContext: context, routerResult: context.routerContext,
  });
  const cleanupBeforeEnd = cleanupCalls;
  await runtimeContext.hooks.onRequestEnd.call({
    runtimeContext: context, terminal: { status: 'complete' },
  });
  return {
    canonicalRegistry: statePlugin.registryHooks === routerProviderRegistryHooks,
    policyInstalledBeforePreparation,
    snapshotStatus: prepared.routerResult?.statusCode,
    snapshotErrorPreserved: prepared.routerResult?.errors?.route === failure,
    nativeFallbackPreserved: context.routerContext.statusCode === 404 && context.routerContext.errors.native === nativeFailure,
    cleanupBeforeEnd,
    cleanupCalls,
    laterConsumersObservedState: observations.length === 2 && observations.every(Boolean),
  };
}`;
  return evaluateRuntimeExport(source);
}

async function evaluateRuntimeExport(source: string) {
  const fixture = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-router-registration-'),
  );
  const fixtureScope = path.join(fixture, 'node_modules/@modern-js');
  fs.mkdirSync(fixtureScope, { recursive: true });
  // An external consumer resolves the package through its installed link,
  // including the package's real public export conditions.
  fs.symlinkSync(
    path.resolve(__dirname, '../..'),
    path.join(fixtureScope, 'ultramodern-app-tools'),
    'junction',
  );
  fs.writeFileSync(path.join(fixture, 'registration.js'), source);
  const compiler = rspack.rspack({
    context: fixture,
    entry: './registration.js',
    mode: 'production',
    target: 'web',
    devtool: false,
    optimization: { minimize: false },
    output: {
      path: fixture,
      filename: 'registration.cjs',
      library: { type: 'commonjs2' },
    },
    resolve: {
      conditionNames: ['browser', 'import', 'default'],
      modules: [path.resolve(__dirname, '../../node_modules'), 'node_modules'],
    },
    module: { parser: { javascript: { importExportsPresence: 'error' } } },
  });
  try {
    await new Promise<void>((resolve, reject) => {
      compiler.run((error, stats) => {
        if (error) reject(error);
        else if (!stats || stats.hasErrors()) {
          reject(
            new Error(
              stats?.toString({ all: false, errors: true }) ??
                'Missing Rspack result',
            ),
          );
        } else resolve();
      });
    });
    const require = createRequire(import.meta.url);
    const output = path.join(fixture, 'registration.cjs');
    try {
      return await require(output).acceptance();
    } finally {
      delete require.cache[output];
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      compiler.close(error => (error ? reject(error) : resolve())),
    );
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

describe('canonical router composition', () => {
  test.each([
    { label: 'pages', metadata: { pageRoutesEntry: '/app/pages' }, router: {} },
    {
      label: 'nested routes',
      metadata: { __modernRoutesOwner: '@modern-js/plugin-router' },
      router: {},
    },
    {
      label: 'configured custom React entry',
      metadata: {},
      router: { framework: 'react-router' },
    },
  ])(
    'replaces the actual native descriptor for each $label entry',
    async ({ metadata, router }) => {
      const { api, appDirectory } = await initializeRouterCli({
        router,
      });
      for (const entryName of ['main', 'admin']) {
        const entrypoint = {
          entryName,
          entry: path.join(appDirectory, 'src', entryName, 'App.tsx'),
          ...metadata,
        };
        const consumer = {
          name: 'consumer',
          path: './consumer-runtime',
          config: { untouched: true },
        };
        const result = await api
          .getHooks()
          ._internalRuntimePlugins.call({ entrypoint, plugins: [consumer] });
        const routers = result.plugins.filter(
          plugin => plugin.name === 'router',
        );
        expect(routers).toEqual([
          {
            name: 'router',
            path: integrationPath,
            config: {
              serverBase: [entryName === 'main' ? '/store' : '/admin'],
            },
          },
        ]);
        expect(result.entrypoint).toBe(entrypoint);
        expect(result.plugins[0]).toBe(consumer);
        expect(
          result.plugins.filter(plugin => plugin.name === 'rendererHead'),
        ).toHaveLength(1);
        expect(
          result.plugins.filter(plugin => plugin.name === 'routerState'),
        ).toEqual([expectedStateDescriptor]);
        const repeated = await api
          .getHooks()
          ._internalRuntimePlugins.call(result);
        expect(
          repeated.plugins.filter(plugin => plugin.name === 'routerState'),
        ).toEqual([expectedStateDescriptor]);
      }
    },
  );

  test.each([
    {
      label: 'custom entry',
      metadata: {},
      name: 'router',
      runtimePath: '@modern-js/plugin-tanstack/runtime/router',
    },
    {
      label: 'TanStack file-route entry',
      metadata: {
        __modernRoutesDir: 'routes',
        __modernRoutesOwner: '@modern-js/plugin-tanstack',
      },
      name: 'tanstackRouter',
      runtimePath: '@modern-js/plugin-tanstack/runtime',
    },
    {
      label: 'native pages beside TanStack',
      metadata: { pageRoutesEntry: '/app/pages' },
      name: 'router',
      runtimePath: integrationPath,
    },
  ])(
    'preserves selected routing for $label when TanStack is installed',
    async ({ metadata, name, runtimePath }) => {
      const { api, appDirectory } = await initializeRouterCli({
        tanstack: true,
        router: { framework: 'tanstack' },
      });
      const result = await api.getHooks()._internalRuntimePlugins.call({
        entrypoint: {
          entryName: 'main',
          entry: path.join(appDirectory, 'src/App.tsx'),
          ...metadata,
        },
        plugins: [],
      });
      expect(
        result.plugins.filter(plugin =>
          ['router', 'tanstackRouter'].includes(plugin.name),
        ),
      ).toEqual([
        {
          name,
          path: runtimePath,
          config: { serverBase: ['/store'] },
        },
      ]);
      expect(
        result.plugins.filter(plugin => plugin.name === 'routerState'),
      ).toEqual([expectedStateDescriptor]);
      const repeated = await api
        .getHooks()
        ._internalRuntimePlugins.call(result);
      expect(
        repeated.plugins.filter(plugin => plugin.name === 'routerState'),
      ).toEqual([expectedStateDescriptor]);
    },
  );

  test.each(['./custom-router', '@foreign/router/runtime'])(
    'preserves explicit descriptor %s and observes plain entries',
    async runtimePath => {
      const { api, appDirectory } = await initializeRouterCli();
      const entrypoint = {
        entryName: 'main',
        entry: path.join(appDirectory, 'src/App.tsx'),
      };
      const custom: RuntimePluginConfig = {
        name: 'router',
        path: runtimePath,
        config: { custom: true },
      };
      const result = await api
        .getHooks()
        ._internalRuntimePlugins.call({ entrypoint, plugins: [custom] });
      expect(result.plugins.find(plugin => plugin.name === 'router')).toBe(
        custom,
      );
      expect(
        result.plugins.filter(plugin => plugin.name === 'routerState'),
      ).toEqual([expectedStateDescriptor]);
      const repeated = await api
        .getHooks()
        ._internalRuntimePlugins.call(result);
      expect(
        repeated.plugins.filter(plugin => plugin.name === 'routerState'),
      ).toEqual([expectedStateDescriptor]);
      expect(repeated.plugins.find(plugin => plugin.name === 'router')).toBe(
        custom,
      );
      const plain = await api
        .getHooks()
        ._internalRuntimePlugins.call({ entrypoint, plugins: [] });
      expect(plain.plugins.some(plugin => plugin.name === 'router')).toBe(
        false,
      );
      expect(
        plain.plugins.filter(plugin => plugin.name === 'routerState'),
      ).toEqual([expectedStateDescriptor]);
    },
  );

  test('the public selected factory installs policy before native and later lifecycle consumers', async () => {
    const { api, appDirectory } = await initializeRouterCli({
      router: { framework: 'react-router' },
    });
    const result = await api.getHooks()._internalRuntimePlugins.call({
      entrypoint: {
        entryName: 'main',
        entry: path.join(appDirectory, 'src/App.tsx'),
      },
      plugins: [],
    });
    const descriptor = result.plugins.find(
      plugin => plugin.path === integrationPath,
    );
    expect(descriptor?.name).toBe('router');
    if (!descriptor) throw new Error('Missing canonical router descriptor');
    const stateDescriptor = result.plugins.find(
      plugin => plugin.name === 'routerState',
    );
    if (!stateDescriptor) throw new Error('Missing router state descriptor');
    const acceptance = await evaluateRouterRuntime(descriptor, stateDescriptor);
    expect(acceptance).toEqual({
      canonicalRegistry: true,
      stateCanonicalRegistry: true,
      policyInstalled: true,
      nativeLinkInstalled: true,
      observedNativeInstance: true,
      policyInstalledBeforeConsumer: true,
      basename: '/store',
    });
  });

  test('the separate public state factory observes custom SSR snapshots and ends request resources', async () => {
    const { api, appDirectory } = await initializeRouterCli();
    const result = await api.getHooks()._internalRuntimePlugins.call({
      entrypoint: {
        entryName: 'main',
        entry: path.join(appDirectory, 'src/App.tsx'),
      },
      plugins: [],
    });
    expect(result.plugins.some(plugin => plugin.name === 'router')).toBe(false);
    expect(
      result.plugins.filter(plugin => plugin.name === 'routerState'),
    ).toEqual([expectedStateDescriptor]);
    const stateDescriptor = result.plugins.find(
      plugin => plugin.name === 'routerState',
    );
    if (!stateDescriptor) throw new Error('Missing router state descriptor');

    expect(await evaluateRouterStateRuntime(stateDescriptor)).toEqual({
      canonicalRegistry: true,
      policyInstalledBeforePreparation: true,
      snapshotStatus: 418,
      snapshotErrorPreserved: true,
      nativeFallbackPreserved: true,
      cleanupBeforeEnd: 0,
      cleanupCalls: 1,
      laterConsumersObservedState: true,
    });
  });
});
