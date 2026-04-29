import type {
  BundlerChain,
  BundlerConfig,
  DefaultBuilderPlugin,
  RsdoctorConfig,
  SharedNormalizedConfig,
} from '@modern-js/builder-shared';
import { promises as fs } from 'fs';
import path from 'path';

type RsdoctorPluginOptions = {
  disableClientServer: boolean;
  reportDir?: string;
  mode?: 'normal' | 'brief' | 'lite';
  loaderInterceptorOptions?: {
    skipLoaders?: string[];
  };
};

type RsdoctorDiagnosticsContract = {
  schemaVersion: 1;
  tool: 'rsdoctor';
  format: 'ultramodern-rsdoctor-contract';
  generatedAt: string;
  mode: 'normal' | 'brief' | 'lite';
  disableClientServer: boolean;
  artifactBaseDir: string;
  artifacts: {
    reportDir: string;
    manifest: string;
    contract: string;
  };
};

const RSDOCTOR_OUTPUT_DIR = '.rsdoctor';
const RSDOCTOR_MANIFEST_FILE = 'manifest.json';
export const RSDOCTOR_DIAGNOSTICS_CONTRACT_FILE =
  'ultramodern-diagnostics.json';

const toPosixPath = (value: string) => value.split(path.sep).join('/');

const getRsdoctorOutputRoot = ({
  reportDir,
  outputPath,
}: {
  reportDir?: string;
  outputPath: string;
}) => path.resolve(reportDir || outputPath, RSDOCTOR_OUTPUT_DIR);

export const createRsdoctorDiagnosticsContract = ({
  outputPath,
  options,
}: {
  outputPath: string;
  options: RsdoctorPluginOptions;
}): RsdoctorDiagnosticsContract => {
  const artifactBaseDir = path.resolve(options.reportDir || outputPath);
  const reportRoot = getRsdoctorOutputRoot({
    outputPath,
    reportDir: options.reportDir,
  });
  const reportDir = toPosixPath(path.relative(artifactBaseDir, reportRoot));

  return {
    schemaVersion: 1,
    tool: 'rsdoctor',
    format: 'ultramodern-rsdoctor-contract',
    generatedAt: new Date().toISOString(),
    mode: options.mode || 'normal',
    disableClientServer: options.disableClientServer,
    artifactBaseDir,
    artifacts: {
      reportDir,
      manifest: toPosixPath(path.join(reportDir, RSDOCTOR_MANIFEST_FILE)),
      contract: toPosixPath(
        path.join(reportDir, RSDOCTOR_DIAGNOSTICS_CONTRACT_FILE),
      ),
    },
  };
};

const writeRsdoctorDiagnosticsContract = async ({
  outputPath,
  options,
}: {
  outputPath: string;
  options: RsdoctorPluginOptions;
}) => {
  const reportRoot = getRsdoctorOutputRoot({
    outputPath,
    reportDir: options.reportDir,
  });
  const contractPath = path.join(
    reportRoot,
    RSDOCTOR_DIAGNOSTICS_CONTRACT_FILE,
  );
  const contract = createRsdoctorDiagnosticsContract({ outputPath, options });

  await fs.mkdir(reportRoot, { recursive: true });
  await fs.writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
};

const createRsdoctorDiagnosticsContractPlugin = (
  options: RsdoctorPluginOptions,
) => ({
  name: 'modern-rsdoctor-diagnostics-contract-plugin',
  apply(compiler: {
    outputPath?: string;
    options?: {
      output?: {
        path?: string;
      };
    };
    hooks: {
      done: {
        tapPromise: (
          options: { name: string; stage: number },
          callback: () => Promise<void>,
        ) => void;
      };
    };
  }) {
    compiler.hooks.done.tapPromise(
      {
        name: 'modern-rsdoctor-diagnostics-contract-plugin',
        stage: 10_000,
      },
      async () => {
        const outputPath =
          compiler.outputPath || compiler.options?.output?.path;

        if (!outputPath) {
          return;
        }

        await writeRsdoctorDiagnosticsContract({ outputPath, options });
      },
    );
  },
});

function applyProfile({
  chain,
  config,
}: {
  chain: BundlerChain;
  config: SharedNormalizedConfig;
}) {
  const { profile } = config.performance;
  if (!profile) {
    return;
  }

  chain.profile(profile);
}

const isRsdoctorEnabled = (config: RsdoctorConfig | undefined) => {
  if (typeof config === 'boolean') {
    return config;
  }

  if (config && typeof config === 'object') {
    if (typeof config.enabled === 'boolean') {
      return config.enabled;
    }

    return true;
  }

  return false;
};

const getRsdoctorPluginOptions = (
  config: RsdoctorConfig | undefined,
): RsdoctorPluginOptions => {
  if (config && typeof config === 'object') {
    return {
      disableClientServer: config.disableClientServer ?? true,
      reportDir: config.reportDir,
      mode: config.mode,
      loaderInterceptorOptions: config.loaderInterceptorOptions,
    };
  }

  return {
    disableClientServer: true,
  };
};

/**
 * Apply some configs of builder performance
 */
export const builderPluginPerformance = (): DefaultBuilderPlugin => ({
  name: 'builder-plugin-performance',

  setup(api) {
    api.modifyBuilderConfig(builderConfig => {
      if (builderConfig.performance?.profile) {
        // generate stats.json
        if (!builderConfig.performance?.bundleAnalyze) {
          builderConfig.performance ??= {};
          builderConfig.performance.bundleAnalyze = {
            analyzerMode: 'disabled',
            generateStatsFile: true,
          };
        } else {
          builderConfig.performance.bundleAnalyze = {
            generateStatsFile: true,
            ...(builderConfig.performance.bundleAnalyze || {}),
          };
        }
      }
    });
    api.modifyBundlerChain(chain => {
      const config = api.getNormalizedConfig();

      applyProfile({ chain, config });
    });

    api.onBeforeCreateCompiler(async ({ bundlerConfigs }) => {
      if (api.context.bundlerType !== 'rspack') {
        return;
      }

      const rsdoctorConfig = api.getNormalizedConfig().performance.rsdoctor;

      if (!isRsdoctorEnabled(rsdoctorConfig)) {
        return;
      }

      const { RsdoctorRspackPlugin } = await import('@rsdoctor/rspack-plugin');
      const rsdoctorPluginOptions = getRsdoctorPluginOptions(rsdoctorConfig);

      (bundlerConfigs as BundlerConfig[]).forEach(config => {
        config.plugins ??= [];
        config.plugins.push(new RsdoctorRspackPlugin(rsdoctorPluginOptions));
        config.plugins.push(
          createRsdoctorDiagnosticsContractPlugin(
            rsdoctorPluginOptions,
          ) as unknown as Exclude<(typeof config.plugins)[number], undefined>,
        );
      });
    });
  },
});
