import os from 'node:os';
import path from 'node:path';
import type { AppTools } from '@modern-js/app-tools';
import {
  type Plugin as BasePlugin,
  createPluginManager,
} from '@modern-js/plugin';
import { createContext, initPluginAPI } from '@modern-js/plugin/cli';
import { server } from '@modern-js/plugin/server';
import {
  type APIServerStartInput,
  compatPlugin,
  handleSetupResult,
  type ServerPlugin,
} from '@modern-js/server-core';
import type { ServerNodeMiddleware } from '@modern-js/server-core/node';
import { fs } from '@modern-js/utils';
import { bffPlugin as nativeBffPlugin } from '../../plugin-bff/src/cli';
import effectServerPlugin from '../../plugin-bff-extensions/src/effect-server';
import { bffPlugin } from '../src';

rstest.mock('@modern-js/plugin-bff', () => ({
  bffPlugin: nativeBffPlugin,
  default: nativeBffPlugin,
}));

async function configuredServerOptions(appDirectory: string) {
  const manager = createPluginManager();
  manager.addPlugins([bffPlugin()]);
  const plugins = manager.getPlugins();
  const config = { bff: {}, source: {}, output: {}, server: {} };
  const context = await createContext<AppTools>({
    appContext: {
      appDirectory,
      apiDirectory: path.join(appDirectory, 'api'),
      lambdaDirectory: path.join(appDirectory, 'api/lambda'),
      plugins,
    } as never,
    config: config as never,
    normalizedConfig: config as never,
  });
  const api = initPluginAPI<AppTools>({ context, pluginManager: manager });
  for (const item of plugins) await item.setup?.(api);
  const configured = await api
    .getHooks()
    ._internalServerPlugins.call({ plugins: [] });
  return configured.plugins[0]!;
}

test('CLI-composed Effect server registers every configured prefix after serializing its options', async () => {
  let effectPaths: string[] = [];
  let apiHandlerInfos: unknown;
  const observer: ServerPlugin = {
    name: 'observe-effect-prefixes',
    setup(api) {
      api.prepareApiServer((async (
        input: APIServerStartInput,
        next: (input: APIServerStartInput) => Promise<ServerNodeMiddleware>,
      ) => {
        apiHandlerInfos = api.getServerContext().apiHandlerInfos;
        return next(input);
      }) as never);
      api.onPrepare(() => {
        effectPaths = api
          .getServerContext()
          .middlewares.filter(
            middleware => middleware.name === 'effect-api-handler',
          )
          .map(middleware => middleware.path ?? '');
      });
    },
  };
  const appDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'bff-server-app-'),
  );
  try {
    await fs.outputJSON(path.join(appDirectory, 'package.json'), {
      private: true,
      dependencies: { '@modern-js/plugin-bff-extensions': '3.8.3' },
    });
    await fs.ensureSymlink(
      path.resolve(__dirname, '../../plugin-bff-extensions'),
      path.join(appDirectory, 'node_modules/@modern-js/plugin-bff-extensions'),
      'dir',
    );
    const descriptor = await configuredServerOptions(appDirectory);
    expect(descriptor.name).toBe(
      '@modern-js/plugin-bff-extensions/effect-server',
    );
    const { serverContext } = await server.run({
      plugins: [compatPlugin(), effectServerPlugin(), observer] as BasePlugin[],
      options: {
        appContext: {
          appDirectory,
          apiDirectory: path.resolve(appDirectory, 'missing-api'),
          bffRuntimeFramework: 'effect',
          middlewares: [],
        },
        pwd: process.cwd(),
      },
      config: { bff: { prefix: ['/api', '/rpc'] } },
      handleSetupResult,
    });
    const hooks = serverContext.pluginAPI!.getHooks();
    expect(apiHandlerInfos).toBeUndefined();
    await hooks.onPrepare.call();
    expect(effectPaths).toEqual(['/api/*', '/rpc/*']);
  } finally {
    await fs.remove(appDirectory);
  }
});
