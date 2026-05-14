import type { Plugin as BasePlugin } from '@modern-js/plugin';
import { server } from '@modern-js/plugin/server';
import {
  compatPlugin,
  handleSetupResult,
  type ServerConfig,
  type ServerPlugin,
} from '@modern-js/server-core';
import { assign } from '@modern-js/utils/lodash';
import path from 'path';
import plugin from '../src/server';

const noop = () => {};

const pwd = path.resolve(__dirname, './fixtures/function');

export async function serverInit({
  plugins,
  serverConfig,
  appContext,
}: {
  plugins?: ServerPlugin[];
  serverConfig?: ServerConfig;
  appContext?: Record<string, unknown>;
}) {
  const { serverContext } = await server.run({
    plugins: [compatPlugin(), ...(plugins || [])] as BasePlugin[],
    options: {
      appContext: {
        bffRuntimeFramework: 'hono',
        ...(appContext || {}),
      },
      pwd: process.cwd(),
    },
    config: assign(
      {},
      {
        dev: {},
        output: {},
        source: {},
        tools: {},
        server: {},
        html: {},
        bff: {},
        security: {},
      },
      serverConfig,
    ),
    handleSetupResult,
  });

  const hooks = serverContext.pluginAPI?.getHooks();
  return hooks as any;
}

describe('bff server plugin', () => {
  describe('prepareApiServer', () => {
    it('should work well', async () => {
      let apiHandlerInfos = null;
      const mockApiPlugin: ServerPlugin = {
        name: 'mock-api',

        setup(api) {
          api.prepareApiServer(((input: any, next: any) => {
            const appContext = api.getServerContext();
            apiHandlerInfos = appContext.apiHandlerInfos;
            return next(input);
          }) as any);
        },
      };

      const hooks = await serverInit({
        plugins: [plugin(), mockApiPlugin],
      });

      await hooks.prepareApiServer.call({
        pwd,
        prefix: '/',
      });

      expect(apiHandlerInfos).toMatchSnapshot();
    });

    it('should work well with prefix', async () => {
      let apiHandlerInfos = null;

      const mockApiPlugin: ServerPlugin = {
        name: 'mock-api',

        setup(api) {
          api.prepareApiServer(((input: any, next: any) => {
            const appContext = api.getServerContext();
            apiHandlerInfos = appContext.apiHandlerInfos;
            return next(input);
          }) as any);
        },
      };

      const hooks = await serverInit({
        plugins: [plugin(), mockApiPlugin],
      });

      await hooks.prepareApiServer.call({ pwd, prefix: '/api' });
      expect(apiHandlerInfos).toMatchSnapshot();
    });

    it('should skip api/lambda handler exposure in effect mode', async () => {
      let apiHandlerInfos = null;
      const mockApiPlugin: ServerPlugin = {
        name: 'mock-api',
        setup(api) {
          api.prepareApiServer(((input: any, next: any) => {
            const appContext = api.getServerContext();
            apiHandlerInfos = appContext.apiHandlerInfos;
            return next(input);
          }) as any);
        },
      };

      const hooks = await serverInit({
        plugins: [plugin(), mockApiPlugin],
        appContext: {
          bffRuntimeFramework: 'effect',
        },
      });

      await hooks.prepareApiServer.call({ pwd, prefix: '/' });
      expect(apiHandlerInfos).toBeUndefined();
    });

    it('should treat unresolved runtime framework as effect', async () => {
      let apiHandlerInfos: Array<{ routePath: string }> | null = null;
      const mockApiPlugin: ServerPlugin = {
        name: 'mock-api',
        setup(api) {
          api.prepareApiServer(((input: any, next: any) => {
            const appContext = api.getServerContext();
            apiHandlerInfos = appContext.apiHandlerInfos;
            return next(input);
          }) as any);
        },
      };

      const hooks = await serverInit({
        plugins: [plugin(), mockApiPlugin],
        appContext: {
          bffRuntimeFramework: undefined,
        },
      });

      await hooks.prepareApiServer.call({ pwd, prefix: '/' });
      expect(apiHandlerInfos).toBeUndefined();
    });
  });
});
