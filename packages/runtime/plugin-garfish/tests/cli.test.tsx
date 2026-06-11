import type { AppUserConfig } from '@modern-js/app-tools';
import WebpackChain from '@modern-js/utils/webpack-chain';
import type { UseConfig } from '../src/cli';
import { externals, garfishPlugin } from '../src/cli';
import { getRuntimeConfig, setRuntimeConfig } from '../src/cli/utils';

const useTestAppContext = () => ({
  internalDirectory: 'dist/.rstest-temp/test',
});
const testChainId = {
  PLUGIN: {
    BANNER: 'banner',
  },
};

const setupGarfishPlugin = async (
  api: Record<string, unknown> = {},
): Promise<any> =>
  garfishPlugin().setup!({
    useConfigContext: () => ({}),
    useResolvedConfigContext: () => ({}),
    useAppContext: useTestAppContext,
    ...api,
  } as any);

describe('plugin-garfish cli', () => {
  test('cli garfish basename', async () => {
    expect(garfishPlugin().name).toBe('@modern-js/plugin-garfish');

    const lifecycle = await setupGarfishPlugin();
    const configHistoryOptions: any = await lifecycle.resolvedConfig({
      resolved: {
        runtime: {
          router: {
            historyOptions: { basename: '/test' },
          },
          masterApp: {},
        },
      },
    } as any);

    expect(configHistoryOptions.resolved.runtime.masterApp.basename).toBe(
      '/test',
    );

    const configHistory: any = await lifecycle.resolvedConfig({
      resolved: {
        runtime: {
          router: {
            basename: '/test2',
          },
          masterApp: {},
        },
      },
    } as any);

    expect(configHistory.resolved.runtime.masterApp.basename).toBe('/test2');
  });

  test('cli get runtime config', () => {
    const runtimeConfig = getRuntimeConfig({
      runtime: {
        masterApp: {
          basename: '/test',
        },
      },
    });
    expect(runtimeConfig).toMatchSnapshot();
  });

  test('cli get runtime features config', () => {
    const runtimeConfig = getRuntimeConfig({
      runtime: {
        masterApp: {
          basename: '/test',
        },
        features: {
          masterApp: {
            basename: '/test2',
          },
        },
      },
    });

    expect(runtimeConfig).toMatchSnapshot();
  });

  test('cli set runtime config', () => {
    const runtimeConfig = {
      runtime: {
        masterApp: {
          basename: '/test',
        },
      },
    };

    setRuntimeConfig(runtimeConfig, 'masterApp', true);

    expect(runtimeConfig.runtime).toMatchSnapshot();
  });

  test('cli set runtime features config', () => {
    const runtimeConfig = {
      runtime: {
        features: {
          masterApp: {
            basename: '/test',
          },
        },
      },
    };

    setRuntimeConfig(runtimeConfig, 'masterApp', true);

    expect(runtimeConfig.runtime).toMatchSnapshot();
  });

  test('webpack config close external and use js entry', async () => {
    const resolveConfig: any = {
      deploy: {
        microFrontend: {
          externalBasicLibrary: true,
          enableHtmlEntry: false,
        },
      },
      server: {
        port: 8080,
      },
    };

    const lifecycle = await setupGarfishPlugin({
      useResolvedConfigContext: () => resolveConfig,
    });
    const config: any = [await lifecycle.config()];
    const webpackConfig = new WebpackChain();

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    function HTMLWebpackPlugin() {}
    webpackConfig.plugin('html-main').use(HTMLWebpackPlugin);

    config[0].tools.bundlerChain(webpackConfig, {
      webpack: rstest.fn(),
      env: 'development',
      CHAIN_ID: testChainId,
      bundler: {
        BannerPlugin: class {
          params: any;

          constructor(params: any) {
            this.params = params;
          }
        },
      },
    });

    const generateConfig = webpackConfig.toConfig();
    expect(generateConfig).toMatchSnapshot();
    expect(generateConfig).toMatchObject({
      output: {
        libraryTarget: 'umd',
        publicPath: '//localhost:8080/',
        filename: 'index.js',
      },
      externals,
      optimization: { runtimeChunk: false, splitChunks: { chunks: 'async' } },
    });
  });

  test('webpack config default micro config', async () => {
    const resolveConfig: any = {
      deploy: {
        microFrontend: true,
      },
      server: {
        port: '8080',
      },
    };

    const lifecycle = await setupGarfishPlugin({
      useResolvedConfigContext: () => resolveConfig,
    });
    const config: any = [await lifecycle.config()];
    const webpackConfig = new WebpackChain();
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    function HTMLWebpackPlugin() {}
    webpackConfig.plugin('html-main').use(HTMLWebpackPlugin);

    config[0].tools.bundlerChain(webpackConfig, {
      webpack: rstest.fn(),
      env: 'development',
      CHAIN_ID: testChainId,
      bundler: {
        BannerPlugin: class {
          params: any;

          constructor(params: any) {
            this.params = params;
          }
        },
      },
    });

    const generateConfig = webpackConfig.toConfig();
    expect(config[0].tools.devServer).toMatchObject({
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    });

    expect(generateConfig).toMatchSnapshot();
    expect(generateConfig).toMatchObject({
      output: {
        libraryTarget: 'umd',
        publicPath: '//localhost:8080/',
      },
    });
    expect(generateConfig.externals).toBeUndefined();
    expect(generateConfig.output!.filename).toBeUndefined();
  });

  test('micro fronted default config disableCssExtract false', async () => {
    const resolveConfig: Partial<UseConfig> = {
      deploy: {
        microFrontend: {},
      },
    };

    const lifecycle = await setupGarfishPlugin({
      useResolvedConfigContext: () => resolveConfig as any,
      useConfigContext: () => resolveConfig,
    });
    const config = [await lifecycle.config()] as AppUserConfig[];
    expect(config[0].output!.disableCssExtract).toBe(false);
  });

  test('micro fronted js entry disableCssExtract true', async () => {
    const resolveConfig: Partial<UseConfig> = {
      output: {
        disableCssExtract: false,
      },
      deploy: {
        microFrontend: {
          enableHtmlEntry: false,
        },
      },
    };

    const lifecycle = await setupGarfishPlugin({
      useResolvedConfigContext: () => resolveConfig as any,
      useConfigContext: () => resolveConfig,
    });
    const config = [await lifecycle.config()] as AppUserConfig[];
    expect(config[0].output!.disableCssExtract).toBe(true);
  });

  test('normal disableCssExtract false', async () => {
    const resolveConfig: Partial<UseConfig> = {};

    const lifecycle = await setupGarfishPlugin({
      useResolvedConfigContext: () => resolveConfig as any,
      useConfigContext: () => resolveConfig,
    });
    const config = [await lifecycle.config()] as AppUserConfig[];
    expect(config[0].output!.disableCssExtract).toBe(false);
  });

  test('micro frontend runtime digest and integrity are injected into source.define', async () => {
    const resolveConfig: Partial<UseConfig> = {
      deploy: {
        microFrontend: {
          runtimeDigest: 'runtime-v1-digest',
          integrity: 'sha256-runtimeIntegrityDigest==',
          attestation: 'attestation-token-v1',
        },
      },
    };

    const lifecycle = await setupGarfishPlugin({
      useResolvedConfigContext: () => resolveConfig as any,
      useConfigContext: () => resolveConfig,
    });
    const config = [await lifecycle.config()] as AppUserConfig[];

    expect(config[0].source?.define).toMatchObject({
      'process.env.MODERN_MF_RUNTIME_DIGEST': '"runtime-v1-digest"',
      'process.env.MODERN_MF_REMOTE_ENTRY_INTEGRITY':
        '"sha256-runtimeIntegrityDigest=="',
      'process.env.MODERN_MF_REMOTE_ENTRY_ATTESTATION':
        '"attestation-token-v1"',
    });
  });
});
