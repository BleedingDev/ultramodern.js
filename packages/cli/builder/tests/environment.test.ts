import { afterEach, describe, expect, it, rstest } from '@rstest/core';
import { join } from 'path';
import { createBuilder } from '../src';
import { pluginEnvironmentDefaults } from '../src/plugins/environmentDefaults';

const createEnvironmentDefaultsBundlerChainHandler = () => {
  let handler: ((chain: any, utils: any) => Promise<void>) | undefined;

  pluginEnvironmentDefaults().setup({
    modifyBundlerChain: (registeredHandler: any) => {
      handler =
        typeof registeredHandler === 'function'
          ? registeredHandler
          : registeredHandler.handler;
    },
    modifyEnvironmentConfig: () => {},
    modifyRsbuildConfig: () => {},
  } as any);

  if (!handler) {
    throw new Error('Expected environment defaults bundler-chain handler.');
  }

  return handler;
};

const createOutputChain = (initialOutput: Record<string, any> = {}) => {
  const output = { ...initialOutput };
  const libraryCalls: any[] = [];

  const chain = {
    output: {
      get: (key: string) => output[key],
      library: (value: any) => {
        libraryCalls.push(value);
        output.library = value;
        return chain.output;
      },
    },
  };

  return { chain, libraryCalls };
};

describe('builder environment compat', () => {
  afterEach(() => {
    rstest.unstubAllEnvs();
  });
  it('should generator environment config correctly', async () => {
    rstest.stubEnv('NODE_ENV', 'development');

    const rsbuild = await createBuilder({
      bundlerType: 'rspack',
      config: {
        environments: {
          client: {},
          server: {
            output: {
              target: 'node',
            },
          },
          workerSSR: {
            output: {
              target: 'web-worker',
            },
          },
        },
      },
      cwd: join(__dirname, '..'),
    });

    const {
      origin: { bundlerConfigs },
    } = await rsbuild.inspectConfig();

    expect(bundlerConfigs.map(c => c.name)).toEqual([
      'client',
      'server',
      'workerSSR',
    ]);

    expect(bundlerConfigs).toMatchSnapshot();
  });

  it('should emit module library for module workerSSR output', async () => {
    const handler = createEnvironmentDefaultsBundlerChainHandler();
    const { chain, libraryCalls } = createOutputChain({ module: true });

    await handler(chain, {
      environment: {
        name: 'workerSSR',
      },
    });

    expect(libraryCalls).toEqual([
      {
        type: 'module',
      },
    ]);
  });

  it('should keep commonjs2 library for non-module workerSSR output', async () => {
    rstest.stubEnv('NODE_ENV', 'production');

    const rsbuild = await createBuilder({
      bundlerType: 'rspack',
      config: {
        environments: {
          workerSSR: {
            output: {
              target: 'web-worker',
            },
          },
        },
      },
      cwd: join(__dirname, '..'),
    });

    const {
      origin: { bundlerConfigs },
    } = await rsbuild.inspectConfig();

    const workerConfig = bundlerConfigs.find(
      config => config.name === 'workerSSR',
    );

    expect(workerConfig?.output?.module).not.toBe(true);
    expect(workerConfig?.output?.library?.type).toBe('commonjs2');
  });
});
