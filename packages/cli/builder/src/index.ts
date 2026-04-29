import { type BuilderInstance, createRspackBuilder } from './createBuilder';
import type { CreateBuilderOptions } from './types';

export {
  type ChainIdentifier,
  type ConfigChain,
  logger,
  type NormalizedConfig,
  type RsbuildConfig,
  type RsbuildContext,
  type RsbuildPlugin,
  type RsbuildPlugins,
  type RsbuildTarget,
  type Rspack,
  type RspackChain,
} from '@rsbuild/core';
export { parseConfig as parseRspackConfig } from './createBuilder';
export {
  castArray,
  isHtmlDisabled,
  RUNTIME_CHUNK_NAME,
  RUNTIME_CHUNK_REGEX,
  SERVICE_WORKER_ENVIRONMENT_NAME,
} from './shared/utils';
export type {
  BuilderConfig,
  BundlerType,
  CacheGroup,
  MetaOptions,
  MultiStats,
  RspackConfig,
  Stats,
  ToolsDevServerConfig,
} from './types';
export type { BuilderInstance, CreateBuilderOptions };
export { createRspackBuilder as createBuilder };
