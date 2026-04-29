import type { ServerConfig } from '@modern-js/server-core';

export {
  type Context,
  type MiddlewareHandler,
  type MiddlewareObj,
  type Next,
  type ServerConfig,
  type ServerPlugin,
  useHonoContext,
} from '@modern-js/server-core';

export * from '@modern-js/server-core/hono';

export type {
  CacheControl,
  CacheOption,
  CacheOptionProvider,
  Container,
  MonitorEvent,
  Monitors,
} from '@modern-js/types';

export const defineServerConfig = (config: ServerConfig): ServerConfig =>
  config;
