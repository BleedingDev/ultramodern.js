import type { RsbuildPlugin } from '@rsbuild/core';
import { afterEach, describe, expect, it, rs } from '@rstest/core';
import { join } from 'path';
import { createBuilder } from '../src';

const collectSwcLoaderOptions = (value: unknown): any[] => {
  const matches: any[] = [];
  const visit = (item: unknown) => {
    if (!item || typeof item !== 'object') {
      return;
    }

    if (
      'loader' in item &&
      (item as { loader?: unknown }).loader === 'builtin:swc-loader'
    ) {
      matches.push((item as { options?: unknown }).options);
    }

    for (const child of Object.values(item)) {
      if (Array.isArray(child)) {
        child.forEach(visit);
      } else {
        visit(child);
      }
    }
  };

  visit(value);
  return matches;
};

describe('builder rspack', () => {
  afterEach(() => {
    rs.unstubAllEnvs();
  });

  it('should generator rspack config correctly', async () => {
    rs.stubEnv('NODE_ENV', 'development');

    const rsbuild = await createBuilder({
      bundlerType: 'rspack',
      config: {
        plugins: [
          {
            name: 'user-plugin',
            setup: () => {},
          },
        ],
      },
      cwd: join(__dirname, '..'),
    });

    const {
      origin: { bundlerConfigs, rsbuildConfig },
    } = await rsbuild.inspectConfig();

    expect(bundlerConfigs[0]).toMatchSnapshot();

    expect(
      rsbuildConfig.plugins?.map(p => (p as RsbuildPlugin)?.name),
    ).toMatchSnapshot();
  });

  it('should generator rspack config correctly when prod', async () => {
    rs.stubEnv('NODE_ENV', 'production');

    const rsbuild = await createBuilder({
      bundlerType: 'rspack',
      config: {
        performance: {
          rsdoctor: false,
        },
      },
      cwd: join(__dirname, '..'),
    });

    const {
      origin: { bundlerConfigs },
    } = await rsbuild.inspectConfig();

    expect(bundlerConfigs[0]).toMatchSnapshot();
  });

  it('should generator rspack config correctly when node', async () => {
    rs.stubEnv('NODE_ENV', 'production');

    const rsbuild = await createBuilder({
      bundlerType: 'rspack',
      config: {
        performance: {
          rsdoctor: false,
        },
        environments: {
          server: {
            output: {
              target: 'node',
            },
          },
        },
      },
      cwd: join(__dirname, '..'),
    });

    const {
      origin: { bundlerConfigs },
    } = await rsbuild.inspectConfig();

    expect(bundlerConfigs[0]).toMatchSnapshot();
  });

  it('should generator rspack config correctly when service-worker', async () => {
    rs.stubEnv('NODE_ENV', 'production');

    const rsbuild = await createBuilder({
      bundlerType: 'rspack',
      config: {
        performance: {
          rsdoctor: false,
        },
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

    expect(bundlerConfigs[0]).toMatchSnapshot();
  });

  it('should enable Rspack 2.1 createRequire parsing by default', async () => {
    const rsbuild = await createBuilder({
      bundlerType: 'rspack',
      config: {},
      cwd: join(__dirname, '..'),
    });

    const {
      origin: { bundlerConfigs },
    } = await rsbuild.inspectConfig();

    expect(bundlerConfigs[0].module.parser.javascript.createRequire).toBe(true);
  });

  it('should configure Rspack 2.1 source phase imports when configured', async () => {
    const rsbuild = await createBuilder({
      bundlerType: 'rspack',
      config: {
        experiments: {
          sourceImport: false,
        },
      },
      cwd: join(__dirname, '..'),
    });

    const {
      origin: { bundlerConfigs },
    } = await rsbuild.inspectConfig();

    expect(bundlerConfigs[0].experiments.sourceImport).toBe(false);
  });

  it('should enable React Compiler in builtin SWC by default', async () => {
    const rsbuild = await createBuilder({
      bundlerType: 'rspack',
      config: {},
      cwd: join(__dirname, '..'),
    });

    const {
      origin: { bundlerConfigs },
    } = await rsbuild.inspectConfig();

    expect(
      collectSwcLoaderOptions(bundlerConfigs[0]).some(
        options => options?.jsc?.transform?.reactCompiler === true,
      ),
    ).toBe(true);
  });

  it('should forward React Compiler options to builtin SWC', async () => {
    const rsbuild = await createBuilder({
      bundlerType: 'rspack',
      config: {
        source: {
          reactCompiler: {
            target: '18',
          },
        },
      },
      cwd: join(__dirname, '..'),
    });

    const {
      origin: { bundlerConfigs },
    } = await rsbuild.inspectConfig();

    expect(
      collectSwcLoaderOptions(bundlerConfigs[0]).some(
        options => options?.jsc?.transform?.reactCompiler?.target === '18',
      ),
    ).toBe(true);
  });

  it('should disable React Compiler in builtin SWC when configured', async () => {
    const rsbuild = await createBuilder({
      bundlerType: 'rspack',
      config: {
        source: {
          reactCompiler: false,
        },
      },
      cwd: join(__dirname, '..'),
    });

    const {
      origin: { bundlerConfigs },
    } = await rsbuild.inspectConfig();

    expect(
      collectSwcLoaderOptions(bundlerConfigs[0]).some(
        options => options?.jsc?.transform?.reactCompiler === false,
      ),
    ).toBe(true);
  });
});
