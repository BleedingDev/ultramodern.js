import type { BuilderConfig } from '@modern-js/builder';
import type { SSGConfig, SSGMultiEntryOptions } from '@modern-js/types';
import type CompressionPlugin from 'compression-webpack-plugin';
import type { UnwrapBuilderConfig } from '../utils';

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

export interface OutputUserConfig
  extends UnwrapBuilderConfig<BuilderConfig, 'output'> {
  /**
   * Enable SSG for self-controlled routing or conventional routing.
   * @default false
   */
  ssg?: SSGConfig;
  /**
   * Specify SSG configuration by entries for multi-entry apps.
   * Takes precedence over `ssg` when provided.
   */
  ssgByEntries?: SSGMultiEntryOptions;
  /**
   * When using convention-based routing, the framework will split js and css based on the route to load on demand.
   * If your project does not want to split js and css based on routes, you can set this option to false.
   * @default true
   */
  splitRouteChunks?: boolean;
  /**
   * Used to control whether to inject convention-based routing information into the HTML.
   * @default true
   */
  enableInlineRouteManifests?: boolean;
  /**
   * Used to control whether to inject convention-based routing information into the HTML.
   * @default false
   */
  disableInlineRouteManifests?: boolean;
  /**
   * Specify the temporary directory for framework generated files.
   */
  tempDir?: string;
  /**
   * Generate precompressed static assets by using compression-webpack-plugin.
   * `true` means enabling both gzip and brotli with default options.
   * @default true
   */
  precompress?: boolean | PrecompressConfig;
}

export type {
  SSGConfig,
  SSGMultiEntryOptions,
  SSGRouteOptions,
  SSGSingleEntryOptions,
} from '@modern-js/types';
