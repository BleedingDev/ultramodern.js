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
import { ultramodernAppTools } from '@modern-js/ultramodern-app-tools';
import { rspack } from '@rsbuild/core';

const integrationPath = '@modern-js/ultramodern-app-tools/router-runtime';

async function initializeRouterCli({
  tanstack = false,
  router = {},
}: {
  tanstack?: boolean;
  router?: Record<string, unknown>;
} = {}) {
  const manager = createPluginManager();
  // Deliberately register the compositor first: its declared ordering must
  // still put its descriptor transform after both framework selectors.
  manager.addPlugins([
    ultramodernAppTools(),
    runtimePlugin({ plugins: [nativeRouterCliPlugin()] }),
    ...(tanstack ? [tanstackRouterPlugin()] : []),
  ]);
  const plugins = manager.getPlugins();
  const appDirectory = path.resolve(__dirname, '../..');
  const config = { router };
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

async function evaluateRouterRuntime(descriptor: RuntimePluginConfig) {
  const fixture = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-router-registration-'),
  );
  const source = `import { ${descriptor.name}Plugin as selectedFactory } from ${JSON.stringify(descriptor.path)};
import { runtime } from '@modern-js/plugin/runtime';
import { getInitialContext } from '@modern-js/runtime/context';
import { routerProviderRegistryHooks } from '@modern-js/runtime/router/internal';
import { getRouterRuntimeState } from '@modern-js/runtime-extensions/router-state';
export async function acceptance() {
  const plugin = selectedFactory(${JSON.stringify(descriptor.config)});
  const observations = [];
  const consumer = {
    name: 'consumer-observes-router',
    pre: ['@modern-js/plugin-router'],
    setup(api) {
      api.onAfterCreateRouter(event => {
        observations.push(getRouterRuntimeState(event.runtimeContext)?.instance);
      });
    },
  };
  const { runtimeContext } = runtime.run({
    config: { router: { framework: 'react-router' } }, plugins: [consumer, plugin],
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
    policyInstalled: context.linkPrefetchPolicy !== undefined,
    nativeLinkInstalled: context.router?.Link !== undefined,
    observedNativeInstance: observations.length === 1 && observations[0] === instance,
    basename: getRouterRuntimeState(context)?.basename,
  };
}`;
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
  ])('replaces the actual native descriptor for each $label entry', async ({
    metadata,
    router,
  }) => {
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
      const routers = result.plugins.filter(plugin => plugin.name === 'router');
      expect(routers).toEqual([
        {
          name: 'router',
          path: integrationPath,
          config: { serverBase: [entryName === 'main' ? '/store' : '/admin'] },
        },
      ]);
      expect(result.entrypoint).toBe(entrypoint);
      expect(result.plugins[0]).toBe(consumer);
      expect(
        result.plugins.filter(plugin => plugin.name === 'rendererHead'),
      ).toHaveLength(1);
    }
  });

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
  ])('preserves selected routing for $label when TanStack is installed', async ({
    metadata,
    name,
    runtimePath,
  }) => {
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
  });

  test('preserves explicit custom descriptors and does not install a router in plain entries', async () => {
    const { api, appDirectory } = await initializeRouterCli();
    const entrypoint = {
      entryName: 'main',
      entry: path.join(appDirectory, 'src/App.tsx'),
    };
    const custom: RuntimePluginConfig = {
      name: 'router',
      path: './custom-router',
      config: { custom: true },
    };
    const result = await api
      .getHooks()
      ._internalRuntimePlugins.call({ entrypoint, plugins: [custom] });
    expect(result.plugins.find(plugin => plugin.name === 'router')).toBe(
      custom,
    );
    const plain = await api
      .getHooks()
      ._internalRuntimePlugins.call({ entrypoint, plugins: [] });
    expect(plain.plugins.some(plugin => plugin.name === 'router')).toBe(false);
  });

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
    const acceptance = await evaluateRouterRuntime(descriptor);
    expect(acceptance).toEqual({
      canonicalRegistry: true,
      policyInstalled: true,
      nativeLinkInstalled: true,
      observedNativeInstance: true,
      basename: '/store',
    });
  });
});
