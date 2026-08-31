import { createServerBase } from '@modern-js/server-core';
import {
  createNodeServer,
  loadServerCliConfig,
  loadServerEnv,
  loadServerPlugins,
  loadServerRuntimeConfig,
} from '@modern-js/server-core/node';
import { disposeServerRuntime } from '@modern-js/server-runtime-extensions/runtime-lifecycle';
import { logger } from '@modern-js/utils';
import { applyPlugins } from './apply';
import type { BaseEnv, ProdServerOptions } from './types';

export type { ServerPlugin } from '@modern-js/server-core';
export type {
  TelemetryHealthEvaluation,
  TelemetryQueueStats,
  TelemetrySloAlert,
} from '@modern-js/server-runtime-extensions';
export {
  createOtlpTelemetryExporter,
  createTelemetryAwareMetrics,
  createVictoriaMetricsTelemetryExporter,
  hasEnabledTelemetryExporters,
  TelemetryHealthMonitor,
  TelemetryRegistry,
  TelemetryStartupHealthError,
} from '@modern-js/server-runtime-extensions';
export { type ApplyPlugins, applyPlugins } from './apply';
export type { BaseEnv, ProdServerOptions } from './types';
export { loadServerPlugins };

export type ProdServerInstance = Awaited<ReturnType<typeof createNodeServer>>;

export const createProdServer = async (
  options: ProdServerOptions,
): Promise<ProdServerInstance> => {
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
  nodeServer.once('close', () => {
    void disposeServerRuntime(server).catch((error: unknown) =>
      logger.error(error),
    );
  });

  try {
    await applyPlugins(server, options, nodeServer);
    await server.init();
  } catch (error) {
    await disposeServerRuntime(server).catch((disposeError: unknown) =>
      logger.error(disposeError),
    );
    throw error;
  }

  return nodeServer;
};

export default createProdServer;
