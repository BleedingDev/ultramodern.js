import { constants as zlibConstants } from 'node:zlib';
import type CompressionPlugin from 'compression-webpack-plugin';
import { builderPluginAdapterPrecompress } from '../../src/builder/shared/builderPlugins/adapterPrecompress';

type CompressionPluginOptions = NonNullable<
  ConstructorParameters<typeof CompressionPlugin>[0]
>;

const applyPrecompressPlugins = (
  precompress: unknown,
  env: { isProd: boolean; target: string } = { isProd: true, target: 'web' },
) => {
  const appliedPlugins: Array<{
    name: string;
    options: CompressionPluginOptions;
  }> = [];

  let modifyBundlerChain:
    | ((chain: unknown, utils: { isProd: boolean; target: string }) => void)
    | undefined;

  const plugin = builderPluginAdapterPrecompress({
    normalizedConfig: {
      output: {
        precompress,
      },
    },
  } as any);

  plugin.setup?.({
    modifyBundlerChain(callback) {
      modifyBundlerChain = callback;
    },
  } as any);

  const chain = {
    plugin(name: string) {
      return {
        use(_pluginCtor: unknown, [options]: [CompressionPluginOptions]) {
          appliedPlugins.push({ name, options });
        },
      };
    },
  };

  modifyBundlerChain?.(chain, env);

  return appliedPlugins;
};

describe('builderPluginAdapterPrecompress', () => {
  it('does not enable precompress when core config leaves it undefined', () => {
    expect(applyPrecompressPlugins(undefined)).toEqual([]);
  });

  it('enables gzip and brotli when explicitly set to true', () => {
    const plugins = applyPrecompressPlugins(true);

    expect(plugins.map(plugin => plugin.name)).toEqual([
      'modern-precompress-gzip',
      'modern-precompress-brotli',
    ]);
  });

  it('preserves explicit codec configuration', () => {
    const plugins = applyPrecompressPlugins({
      gzip: false,
      brotli: {
        threshold: 2048,
      },
    });

    expect(plugins).toHaveLength(1);
    expect(plugins[0]?.name).toBe('modern-precompress-brotli');
    expect(plugins[0]?.options.threshold).toBe(2048);
  });

  it('merges brotli params with default quality', () => {
    const plugins = applyPrecompressPlugins({
      gzip: false,
      brotli: {
        compressionOptions: {
          params: {
            [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
          },
        },
      },
    });

    expect(plugins).toHaveLength(1);
    expect(plugins[0]?.options.compressionOptions).toEqual({
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 9,
        [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
      },
    });
  });

  it('stays disabled when explicitly set to false', () => {
    expect(applyPrecompressPlugins(false)).toEqual([]);
  });
});
