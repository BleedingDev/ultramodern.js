import { createServerBase } from '@modern-js/server-core';
import {
  createNodeServer,
  loadServerCliConfig,
  loadServerEnv,
  loadServerPlugins,
  loadServerRuntimeConfig,
} from '@modern-js/server-core/node';
import { applyPlugins } from './apply';
import type { BaseEnv, ProdServerOptions } from './types';

export type { ServerPlugin } from '@modern-js/server-core';
export { type ApplyPlugins, applyPlugins } from './apply';
export type {
  TelemetryCanaryDecision,
  TelemetryQueueStats,
  TelemetrySloAlert,
} from './libs/telemetry';
export {
  createOtlpTelemetryExporter,
  createTelemetryAwareMetrics,
  createVictoriaMetricsTelemetryExporter,
  hasEnabledTelemetryExporters,
  TelemetryCanaryOrchestrator,
  TelemetryRegistry,
  TelemetryStartupHealthError,
} from './libs/telemetry';
export type { BaseEnv, ProdServerOptions } from './types';
export { loadServerPlugins };

export const createProdServer = async (options: ProdServerOptions) => {
  await loadServerEnv(options);

  const serverBaseOptions = options;

  const serverCliConfig =
    process.env.NODE_ENV === 'production'
      ? loadServerCliConfig(options.pwd, options.config)
      : options.config;

  if (serverCliConfig) {
    serverBaseOptions.config = serverCliConfig;
  }

  const serverRuntimeConfig = await loadServerRuntimeConfig(
    options.serverConfigPath,
  );

  if (serverRuntimeConfig) {
    serverBaseOptions.serverConfig = serverRuntimeConfig;
    serverBaseOptions.plugins = [
      ...(serverRuntimeConfig.plugins || []),
      ...(options.plugins || []),
    ];
  }

  const server = createServerBase<BaseEnv>(serverBaseOptions);

  // load env file.
  const nodeServer = await createNodeServer(server.handle.bind(server));

  await applyPlugins(server, options, nodeServer);

  await server.init();

  return nodeServer;
};

export default createProdServer;
