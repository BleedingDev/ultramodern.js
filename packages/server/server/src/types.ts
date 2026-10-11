import type { Server as NodeServer } from 'node:http';
import type { Http2SecureServer } from 'node:http2';
import type { BuilderInstance, Rspack } from '@modern-js/builder';
import type {
  ServerBase,
  ServerBaseOptions,
  ServerPlugin,
} from '@modern-js/server-core';
import type { DevServerOptions } from './types/dev';

export type {
  CorsOptions,
  DevServerConfig,
  DevServerHttpsOptions,
  DevServerOptions,
} from './types/dev';

export type ExtraOptions = {
  dev: DevServerOptions;

  runCompile?: boolean;

  serverConfigPath: string;

  builder?: BuilderInstance;

  plugins?: ServerPlugin[];
};

export type ModernDevServerOptions<
  O extends ServerBaseOptions = ServerBaseOptions,
> = O & ExtraOptions;

export type ApplyPlugins<O extends ServerBaseOptions = ServerBaseOptions> = (
  server: ServerBase,
  options: ModernDevServerOptions<O>,
  nodeServer?: NodeServer | Http2SecureServer,
) => Promise<void>;
