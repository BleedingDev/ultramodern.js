import { describe, expect, it } from '@rstest/core';
import { join } from 'path';
import { createBuilder } from '../src';

describe('builder rspack with cache', () => {
  it('should disable cache by default', async () => {
    const rsbuild = await createBuilder({
      bundlerType: 'rspack',
      config: {},
      frameworkConfigPath: 'modern.config.ts',
      cwd: join(__dirname, '..'),
    });

    const {
      origin: { bundlerConfigs },
    } = await rsbuild.inspectConfig();

    expect(bundlerConfigs[0].cache).toMatchSnapshot();
  });

  it('should generator rspack config correctly with cache', async () => {
    const rsbuild = await createBuilder({
      bundlerType: 'rspack',
      config: {
        performance: {
          buildCache: true,
        },
      },
      frameworkConfigPath: 'modern.config.ts',
      cwd: join(__dirname, '..'),
    });

    const {
      origin: { bundlerConfigs },
    } = await rsbuild.inspectConfig();

    expect(bundlerConfigs[0].cache).toMatchSnapshot();
  });

  it('should isolate persistent cache directories by environment', async () => {
    const cacheDirectory = 'node_modules/.cache/rspack-ultramodern-app';
    const rsbuild = await createBuilder({
      bundlerType: 'rspack',
      config: {
        performance: {
          buildCache: {
            cacheDirectory,
            cacheDigest: ['ultramodern-app', 'cloudflare'],
          },
        },
        environments: {
          client: {
            output: {
              target: 'web',
            },
          },
          server: {
            output: {
              target: 'node',
            },
          },
          workerSSR: {
            output: {
              target: 'web',
            },
          },
        },
      },
      frameworkConfigPath: 'modern.config.ts',
      cwd: join(__dirname, '..'),
    });

    const {
      origin: { bundlerConfigs },
    } = await rsbuild.inspectConfig();

    const directories = Object.fromEntries(
      bundlerConfigs.map(config => [
        String(config.cache.version).split('-')[0],
        config.cache.storage.directory,
      ]),
    );
    const expectedRoot = join(__dirname, '..', cacheDirectory);

    expect(directories.client).toBe(join(expectedRoot, 'client'));
    expect(directories.server).toBe(join(expectedRoot, 'server'));
    expect(directories.workerSSR).toBe(join(expectedRoot, 'workerSSR'));
    expect(new Set(Object.values(directories)).size).toBe(
      Object.values(directories).length,
    );
  });
});
