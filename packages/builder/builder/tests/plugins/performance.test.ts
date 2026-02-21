import { describe, expect, it, vi } from 'vitest';
import { builderPluginPerformance } from '@/plugins/performance';

vi.mock('@rsdoctor/rspack-plugin', () => ({
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
    modifyBundlerChain: (cb: (chain: any, utils: { isProd: boolean }) => void) => {
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
      profile: vi.fn(),
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

  it('should enable rsdoctor by default in production rspack build', async () => {
    const { onBeforeCreateCompilerCb } = createPluginApi({});
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
    expect(bundlerConfigs[0].plugins).toHaveLength(1);
    expect(rsdoctorPlugin.options).toEqual({
      disableClientServer: true,
    });
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
    expect(bundlerConfigs[0].plugins).toHaveLength(1);
    expect(rsdoctorPlugin.options).toEqual({
      disableClientServer: true,
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
    expect(bundlerConfigs[0].plugins).toHaveLength(1);
    expect(rsdoctorPlugin.options).toEqual({
      disableClientServer: false,
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
