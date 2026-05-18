import { describe, expect, it, rstest } from '@rstest/core';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  builderPluginPerformance,
  createRsdoctorDiagnosticsContract,
  RSDOCTOR_DIAGNOSTICS_CONTRACT_FILE,
} from '@/plugins/performance';

rstest.mock('@rsdoctor/rspack-plugin', () => ({
  RsdoctorRspackPlugin: class RsdoctorRspackPlugin {
    options: unknown;

    constructor(options: unknown) {
      this.options = options;
    }
  },
}));

const createPluginApi = ({
  bundlerType = 'rspack',
  performance = {},
}: {
  bundlerType?: 'rspack' | 'webpack';
  performance?: Record<string, unknown>;
}) => {
  let modifyBuilderConfigCb: ((builderConfig: any) => void) | undefined;
  let modifyBundlerChainCb:
    | ((chain: any, utils: { isProd: boolean }) => void)
    | undefined;
  let onBeforeCreateCompilerCb:
    | ((params: { bundlerConfigs: any[] }) => Promise<void>)
    | undefined;

  const api = {
    context: {
      bundlerType,
    },
    getNormalizedConfig: () => ({
      performance: {
        profile: false,
        ...performance,
      },
    }),
    modifyBuilderConfig: (cb: (builderConfig: any) => void) => {
      modifyBuilderConfigCb = cb;
    },
    modifyBundlerChain: (
      cb: (chain: any, utils: { isProd: boolean }) => void,
    ) => {
      modifyBundlerChainCb = cb;
    },
    onBeforeCreateCompiler: (
      cb: (params: { bundlerConfigs: any[] }) => Promise<void>,
    ) => {
      onBeforeCreateCompilerCb = cb;
    },
  };

  builderPluginPerformance().setup(api as any);

  return {
    modifyBuilderConfigCb,
    modifyBundlerChainCb,
    onBeforeCreateCompilerCb,
  };
};

const createChain = () => {
  return {
    chain: {
      profile: rstest.fn(),
    },
  };
};

describe('plugins/performance', () => {
  it('should generate stats file options when profile is enabled', async () => {
    const { modifyBuilderConfigCb } = createPluginApi({});
    const builderConfig = {
      performance: {
        profile: true,
      },
    };

    modifyBuilderConfigCb?.(builderConfig);

    expect(builderConfig.performance.bundleAnalyze).toEqual({
      analyzerMode: 'disabled',
      generateStatsFile: true,
    });
  });

  it('should apply profile to bundler chain when enabled', async () => {
    const { modifyBundlerChainCb } = createPluginApi({
      performance: {
        profile: true,
      },
    });
    const { chain } = createChain();

    modifyBundlerChainCb?.(chain, {
      isProd: true,
    });

    expect(chain.profile).toHaveBeenCalledWith(true);
  });

  it('should not enable rsdoctor by default in production rspack build', async () => {
    const { onBeforeCreateCompilerCb } = createPluginApi({});
    const bundlerConfigs: Array<Record<string, unknown>> = [{}];
    const { NODE_ENV } = process.env;
    process.env.NODE_ENV = 'production';

    await onBeforeCreateCompilerCb?.({
      bundlerConfigs,
    });

    process.env.NODE_ENV = NODE_ENV;

    expect(bundlerConfigs[0].plugins).toBeUndefined();
  });

  it('should not enable rsdoctor by default in development build', async () => {
    const { onBeforeCreateCompilerCb } = createPluginApi({});
    const bundlerConfigs: Array<Record<string, unknown>> = [{}];
    const { NODE_ENV } = process.env;
    process.env.NODE_ENV = 'development';

    await onBeforeCreateCompilerCb?.({
      bundlerConfigs,
    });

    process.env.NODE_ENV = NODE_ENV;

    expect(bundlerConfigs[0].plugins).toBeUndefined();
  });

  it('should allow force enabling rsdoctor in development', async () => {
    const { onBeforeCreateCompilerCb } = createPluginApi({
      performance: {
        rsdoctor: true,
      },
    });
    const bundlerConfigs: Array<Record<string, unknown>> = [{}];
    const { NODE_ENV } = process.env;
    process.env.NODE_ENV = 'development';

    await onBeforeCreateCompilerCb?.({
      bundlerConfigs,
    });

    process.env.NODE_ENV = NODE_ENV;

    const rsdoctorPlugin = bundlerConfigs[0].plugins?.[0] as {
      options?: unknown;
    };
    expect(bundlerConfigs[0].plugins).toHaveLength(2);
    expect(rsdoctorPlugin.options).toEqual({
      disableClientServer: true,
    });
  });

  it('should enable rsdoctor when configured with options object', async () => {
    const { onBeforeCreateCompilerCb } = createPluginApi({
      performance: {
        rsdoctor: {
          mode: 'brief',
        },
      },
    });
    const bundlerConfigs: Array<Record<string, unknown>> = [{}];
    const { NODE_ENV } = process.env;
    process.env.NODE_ENV = 'development';

    await onBeforeCreateCompilerCb?.({
      bundlerConfigs,
    });

    process.env.NODE_ENV = NODE_ENV;

    const rsdoctorPlugin = bundlerConfigs[0].plugins?.[0] as {
      options?: unknown;
    };
    expect(bundlerConfigs[0].plugins).toHaveLength(2);
    expect(rsdoctorPlugin.options).toEqual({
      disableClientServer: true,
      mode: 'brief',
    });
  });

  it('should allow disableClientServer override', async () => {
    const { onBeforeCreateCompilerCb } = createPluginApi({
      performance: {
        rsdoctor: {
          enabled: true,
          disableClientServer: false,
        },
      },
    });
    const bundlerConfigs: Array<Record<string, unknown>> = [{}];
    const { NODE_ENV } = process.env;
    process.env.NODE_ENV = 'production';

    await onBeforeCreateCompilerCb?.({
      bundlerConfigs,
    });

    process.env.NODE_ENV = NODE_ENV;

    const rsdoctorPlugin = bundlerConfigs[0].plugins?.[0] as {
      options?: unknown;
    };
    expect(bundlerConfigs[0].plugins).toHaveLength(2);
    expect(rsdoctorPlugin.options).toEqual({
      disableClientServer: false,
    });
  });

  it('should allow reportDir and mode overrides', async () => {
    const { onBeforeCreateCompilerCb } = createPluginApi({
      performance: {
        rsdoctor: {
          enabled: true,
          reportDir: '/tmp/rsdoctor-artifacts',
          mode: 'brief',
        },
      },
    });
    const bundlerConfigs: Array<Record<string, unknown>> = [{}];
    const { NODE_ENV } = process.env;
    process.env.NODE_ENV = 'production';

    await onBeforeCreateCompilerCb?.({
      bundlerConfigs,
    });

    process.env.NODE_ENV = NODE_ENV;

    const rsdoctorPlugin = bundlerConfigs[0].plugins?.[0] as {
      options?: unknown;
    };
    expect(rsdoctorPlugin.options).toEqual({
      disableClientServer: true,
      reportDir: '/tmp/rsdoctor-artifacts',
      mode: 'brief',
    });
  });

  it('should forward loader interceptor options', async () => {
    const { onBeforeCreateCompilerCb } = createPluginApi({
      performance: {
        rsdoctor: {
          enabled: true,
          loaderInterceptorOptions: {
            skipLoaders: ['postcss-loader'],
          },
        },
      },
    });
    const bundlerConfigs: Array<Record<string, unknown>> = [{}];
    const { NODE_ENV } = process.env;
    process.env.NODE_ENV = 'production';

    await onBeforeCreateCompilerCb?.({
      bundlerConfigs,
    });

    process.env.NODE_ENV = NODE_ENV;

    const rsdoctorPlugin = bundlerConfigs[0].plugins?.[0] as {
      options?: unknown;
    };
    expect(rsdoctorPlugin.options).toEqual({
      disableClientServer: true,
      loaderInterceptorOptions: {
        skipLoaders: ['postcss-loader'],
      },
    });
  });

  it('should emit diagnostics contract artifact', async () => {
    const { onBeforeCreateCompilerCb } = createPluginApi({
      performance: {
        rsdoctor: true,
      },
    });
    const bundlerConfigs: Array<Record<string, unknown>> = [{}];
    const { NODE_ENV } = process.env;
    process.env.NODE_ENV = 'production';

    await onBeforeCreateCompilerCb?.({
      bundlerConfigs,
    });

    process.env.NODE_ENV = NODE_ENV;

    const diagnosticsPlugin = bundlerConfigs[0].plugins?.[1] as {
      apply: (compiler: {
        outputPath: string;
        hooks: {
          done: {
            tapPromise: (
              options: { name: string; stage: number },
              callback: () => Promise<void>,
            ) => void;
          };
        };
      }) => void;
    };
    const outputPath = await fs.mkdtemp(
      path.join(os.tmpdir(), 'modern-rsdoctor-contract-'),
    );
    let doneCallback: (() => Promise<void>) | undefined;

    diagnosticsPlugin.apply({
      outputPath,
      hooks: {
        done: {
          tapPromise: (_options, callback) => {
            doneCallback = callback;
          },
        },
      },
    });

    await doneCallback?.();

    const artifactPath = path.join(
      outputPath,
      '.rsdoctor',
      RSDOCTOR_DIAGNOSTICS_CONTRACT_FILE,
    );
    const artifactRaw = await fs.readFile(artifactPath, 'utf8');
    const artifact = JSON.parse(artifactRaw);

    expect(artifact).toMatchObject({
      schemaVersion: 1,
      tool: 'rsdoctor',
      artifacts: {
        reportDir: '.rsdoctor',
        manifest: '.rsdoctor/manifest.json',
        contract: `.rsdoctor/${RSDOCTOR_DIAGNOSTICS_CONTRACT_FILE}`,
      },
      disableClientServer: true,
    });

    await fs.rm(outputPath, { recursive: true, force: true });
  });

  it('should create deterministic diagnostics contract payload', async () => {
    const contract = createRsdoctorDiagnosticsContract({
      outputPath: '/workspace/dist',
      options: {
        disableClientServer: true,
        reportDir: '/workspace/custom-artifacts',
        mode: 'lite',
      },
    });

    expect(contract).toMatchObject({
      schemaVersion: 1,
      tool: 'rsdoctor',
      mode: 'lite',
      artifactBaseDir: '/workspace/custom-artifacts',
      artifacts: {
        reportDir: '.rsdoctor',
        manifest: '.rsdoctor/manifest.json',
        contract: `.rsdoctor/${RSDOCTOR_DIAGNOSTICS_CONTRACT_FILE}`,
      },
    });
  });

  it('should not apply rsdoctor for webpack builds', async () => {
    const { onBeforeCreateCompilerCb } = createPluginApi({
      bundlerType: 'webpack',
    });
    const bundlerConfigs: Array<Record<string, unknown>> = [{}];
    const { NODE_ENV } = process.env;
    process.env.NODE_ENV = 'production';

    await onBeforeCreateCompilerCb?.({
      bundlerConfigs,
    });

    process.env.NODE_ENV = NODE_ENV;

    expect(bundlerConfigs[0].plugins).toBeUndefined();
  });
});
