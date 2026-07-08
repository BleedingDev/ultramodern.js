import { constants as zlibConstants } from 'node:zlib';
import type { RsbuildPlugin } from '@rsbuild/core';
import CompressionPlugin from 'compression-webpack-plugin';
import type { AppNormalizedConfig } from '../../../types';
import type { PrecompressConfig } from '../../../types/config/precompress';
import type { BuilderOptions } from '../types';

type CompressionPluginOptions = NonNullable<
  ConstructorParameters<typeof CompressionPlugin>[0]
>;

const DEFAULT_PRECOMPRESS_TEST = /\.(js|mjs|cjs|css|html|svg|json|map)$/i;
const DEFAULT_PRECOMPRESS_THRESHOLD = 10 * 1024;
const DEFAULT_PRECOMPRESS_MIN_RATIO = 0.8;

const createDefaultGzipOptions = (): CompressionPluginOptions => ({
  algorithm: 'gzip',
  filename: '[path][base].gz',
  test: DEFAULT_PRECOMPRESS_TEST,
  threshold: DEFAULT_PRECOMPRESS_THRESHOLD,
  minRatio: DEFAULT_PRECOMPRESS_MIN_RATIO,
  compressionOptions: {
    level: 6,
  },
});

const createDefaultBrotliOptions = (): CompressionPluginOptions => ({
  algorithm: 'brotliCompress',
  filename: '[path][base].br',
  test: DEFAULT_PRECOMPRESS_TEST,
  threshold: DEFAULT_PRECOMPRESS_THRESHOLD,
  minRatio: DEFAULT_PRECOMPRESS_MIN_RATIO,
  compressionOptions: {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 9,
    },
  },
});

const mergeCompressionOptions = (
  base: CompressionPluginOptions,
  next: CompressionPluginOptions,
): CompressionPluginOptions => {
  const merged = {
    ...base,
    ...next,
  };

  if (base.compressionOptions || next.compressionOptions) {
    const baseCompressionOptions = base.compressionOptions as
      | Record<string, unknown>
      | undefined;
    const nextCompressionOptions = next.compressionOptions as
      | Record<string, unknown>
      | undefined;
    const mergedCompressionOptions = {
      ...baseCompressionOptions,
      ...nextCompressionOptions,
    };

    if (baseCompressionOptions?.params || nextCompressionOptions?.params) {
      mergedCompressionOptions.params = {
        ...(baseCompressionOptions?.params as Record<string, unknown>),
        ...(nextCompressionOptions?.params as Record<string, unknown>),
      };
    }

    merged.compressionOptions = mergedCompressionOptions;
  }

  return merged;
};

const resolveCodecOptions = (
  codecConfig: PrecompressConfig['gzip'] | PrecompressConfig['brotli'],
  createDefaultOptions: () => CompressionPluginOptions,
): CompressionPluginOptions | null => {
  if (codecConfig === false) {
    return null;
  }

  if (codecConfig === undefined || codecConfig === true) {
    return createDefaultOptions();
  }

  return mergeCompressionOptions(createDefaultOptions(), codecConfig);
};

const resolvePrecompressConfig = (
  normalizedConfig: AppNormalizedConfig,
): PrecompressConfig | false => {
  const precompress = normalizedConfig.output.precompress;
  if (precompress === false || precompress === undefined) {
    return false;
  }

  if (precompress === true) {
    return {};
  }

  return precompress;
};

export const builderPluginAdapterPrecompress = (
  options: BuilderOptions,
): RsbuildPlugin => ({
  name: 'builder-plugin-adapter-modern-precompress',

  setup(api) {
    api.modifyBundlerChain((chain, { isProd, target }) => {
      if (!isProd || target !== 'web') {
        return;
      }

      const precompressConfig = resolvePrecompressConfig(
        options.normalizedConfig,
      );
      if (precompressConfig === false) {
        return;
      }

      const gzipOptions = resolveCodecOptions(
        precompressConfig.gzip,
        createDefaultGzipOptions,
      );
      if (gzipOptions) {
        chain
          .plugin('modern-precompress-gzip')
          .use(CompressionPlugin, [gzipOptions]);
      }

      const brotliOptions = resolveCodecOptions(
        precompressConfig.brotli,
        createDefaultBrotliOptions,
      );
      if (brotliOptions) {
        chain
          .plugin('modern-precompress-brotli')
          .use(CompressionPlugin, [brotliOptions]);
      }
    });
  },
});
