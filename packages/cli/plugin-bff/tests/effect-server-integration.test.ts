import type { Plugin as BasePlugin } from '@modern-js/plugin';
import { server } from '@modern-js/plugin/server';
import {
  compatPlugin,
  handleSetupResult,
  type ServerPlugin,
} from '@modern-js/server-core';
import path from 'path';
import plugin from '../src/server';

test('the Effect-first server registers every configured prefix', async () => {
  let effectPaths: string[] = [];
  const observer: ServerPlugin = {
    name: 'observe-effect-prefixes',
    setup(api) {
      api.onPrepare(() => {
        effectPaths = (
          api.getServerContext().middlewares as Array<{
            name?: string;
            path?: string;
          }>
        )
          .filter(middleware => middleware.name === 'effect-api-handler')
          .map(middleware => middleware.path ?? '');
      });
    },
  };
  const appDirectory = path.resolve(__dirname, './fixtures/function');
  const { serverContext } = await server.run({
    plugins: [compatPlugin(), plugin(), observer] as BasePlugin[],
    options: {
      appContext: {
        appDirectory,
        apiDirectory: path.resolve(appDirectory, 'missing-api'),
        bffRuntimeFramework: 'effect',
        middlewares: [],
      },
      pwd: process.cwd(),
    },
    config: {
      bff: { prefix: ['/api', '/rpc'] },
    },
    handleSetupResult,
  });

  await serverContext.pluginAPI?.getHooks().onPrepare.call();

  expect(effectPaths).toEqual(['/api/*', '/rpc/*']);
});
