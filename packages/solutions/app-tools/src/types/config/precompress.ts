import type CompressionPlugin from 'compression-webpack-plugin';

type CompressionPluginOptions = NonNullable<
  ConstructorParameters<typeof CompressionPlugin>[0]
>;

export type PrecompressCodecOptions = boolean | CompressionPluginOptions;

export interface PrecompressConfig {
  /**
   * Configure gzip precompression options.
   * `true` means using default options.
   * `false` means disabling gzip precompression.
   * @default true
   */
  gzip?: PrecompressCodecOptions;
  /**
   * Configure brotli precompression options.
   * `true` means using default options.
   * `false` means disabling brotli precompression.
   * @default true
   */
  brotli?: PrecompressCodecOptions;
}
