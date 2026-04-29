import type {
  CLIPluginAPI,
  CLIPluginExtends,
  RuntimePluginConfig,
  ServerPluginConfig,
} from '@modern-js/plugin';
import type {
  AppTools,
  AppToolsNormalizedConfig,
  AppToolsUserConfig,
} from './config';

export type { Rspack } from '@modern-js/builder';
export type {
  BffNormalizedConfig,
  BffUserConfig,
  LoaderContext,
  OnError,
  OnTiming,
  Params,
  RequestHandler,
  RequestHandlerConfig,
  RequestHandlerOptions,
  // render request handler
  Resource,
  ServerNormalizedConfig,
  ServerUserConfig,
  SSR,
  SSRByEntries,
} from '@modern-js/server-core';
// TODO 导出有限内容
export * from './config';
export type { CLIPluginExtends, RuntimePluginConfig, ServerPluginConfig };

export type AppUserConfig = AppToolsUserConfig;

export type AppNormalizedConfig = AppToolsNormalizedConfig;

export type AppToolsAPI = CLIPluginAPI<AppTools>;

export type {
  AppToolsContext,
  AppToolsExtendAPI,
  AppToolsExtendContext,
  AppToolsExtendHooks,
  AppToolsHooks as AppToolsFeatureHooks,
} from './plugin';
