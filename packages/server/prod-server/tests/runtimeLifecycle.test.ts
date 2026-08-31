import { EventEmitter } from 'node:events';
import { createServerBase } from '@modern-js/server-core';
import {
  createNodeServer,
  loadServerEnv,
  loadServerRuntimeConfig,
} from '@modern-js/server-core/node';
import { registerServerRuntimeDisposer } from '../../runtime-extensions/src/runtimeLifecycle';
import { applyPlugins } from '../src/apply';
import { createProdServer } from '../src/index';

rstest.mock('@modern-js/server-core', () => ({
  createServerBase: rstest.fn(),
}));
rstest.mock('@modern-js/server-core/node', () => ({
  createNodeServer: rstest.fn(),
  loadServerCliConfig: rstest.fn(),
  loadServerEnv: rstest.fn(),
  loadServerPlugins: rstest.fn(),
  loadServerRuntimeConfig: rstest.fn(),
}));
rstest.mock('../src/apply', () => ({
  applyPlugins: rstest.fn(),
}));

const options = () =>
  ({
    appContext: {},
    config: { server: {} },
    pwd: '/tmp/runtime-lifecycle',
  }) as any;

const setup = (init: () => Promise<void>) => {
  const server = {
    handle: rstest.fn(),
    init: rstest.fn(init),
  };
  const nodeServer = new EventEmitter();
  rstest.mocked(createServerBase).mockReturnValue(server as never);
  rstest.mocked(createNodeServer).mockResolvedValue(nodeServer as never);
  rstest.mocked(loadServerEnv).mockResolvedValue(undefined);
  rstest.mocked(loadServerRuntimeConfig).mockResolvedValue(undefined);
  rstest.mocked(applyPlugins).mockResolvedValue(undefined);
  return { nodeServer, server };
};

describe('production server runtime lifecycle', () => {
  test('releases the active runtime once when the node server closes', async () => {
    const { nodeServer, server } = setup(async () => {});
    const dispose = rstest.fn(async () => {});
    registerServerRuntimeDisposer(server, dispose);

    const result = await createProdServer(options());
    expect(result).toBe(nodeServer);

    nodeServer.emit('close');
    nodeServer.emit('close');
    await Promise.resolve();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  test('releases an initialized candidate when later setup fails', async () => {
    const setupError = new Error('server init failed');
    const { server } = setup(async () => {
      throw setupError;
    });
    const dispose = rstest.fn(async () => {});
    registerServerRuntimeDisposer(server, dispose);

    await expect(createProdServer(options())).rejects.toBe(setupError);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
