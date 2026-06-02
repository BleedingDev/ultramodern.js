import { createRequire } from 'node:module';
import path from 'node:path';
import { mergeConfig } from '@modern-js/plugin/cli';
import type { AppUserConfig } from './types';

export interface AppBaselineOptions {
  /**
   * Stable producer identity used by BFF cross-project clients.
   * @default "app"
   */
  appId?: string;
  /**
   * Enable BFF requestId contract by default.
   * @default true
   */
  enableBffRequestId?: boolean;
  /**
   * Enable telemetry contract by default.
   * Exporters are still configured separately by applications.
   * @default true
   */
  enableTelemetry?: boolean;
  /**
   * Enable telemetry exporters by default.
   * @default true
   */
  enableTelemetryExporters?: boolean;
  /**
   * OTLP exporter endpoint.
   * @default process.env.MODERN_TELEMETRY_OTLP_ENDPOINT || 'http://127.0.0.1:4318/v1/logs'
   */
  otlpEndpoint?: string;
  /**
   * VictoriaMetrics exporter endpoint.
   * @default process.env.MODERN_TELEMETRY_VICTORIA_ENDPOINT || 'http://127.0.0.1:8428/api/v1/import/prometheus'
   */
  victoriaMetricsEndpoint?: string;
  /**
   * Enable fail-loud startup probing for telemetry exporters.
   * @default true
   */
  telemetryFailLoudStartup?: boolean;
  /**
   * Enable app-level Module Federation SSR handshake by default.
   * @default true
   */
  enableModuleFederationSSR?: boolean;
}

const resolveReactRouterPackageDir = () => {
  const localRequire = createRequire(path.join(process.cwd(), 'package.json'));
  try {
    const reactRouterDomPackageJson = localRequire.resolve(
      'react-router-dom/package.json',
      { paths: [process.cwd()] },
    );
    const reactRouterPackageJson = localRequire.resolve(
      'react-router/package.json',
      { paths: [path.dirname(reactRouterDomPackageJson)] },
    );
    return path.dirname(reactRouterPackageJson);
  } catch {
    return undefined;
  }
};

const setReactRouterBridgeSafeAliases = (chain: any) => {
  const reactRouterPackageDir = resolveReactRouterPackageDir();
  if (!reactRouterPackageDir) {
    return;
  }

  const productionEntry = path.join(
    reactRouterPackageDir,
    'dist/production/index.mjs',
  );
  const developmentEntry = path.join(
    reactRouterPackageDir,
    'dist/development/index.mjs',
  );

  chain.resolve.alias.set('react-router$', productionEntry);
  chain.resolve.alias.set(
    'react-router/dist/production/index.js',
    productionEntry,
  );
  chain.resolve.alias.set(
    'react-router/dist/development/index.js',
    developmentEntry,
  );
};

export const createAppBaselineConfig = (
  options: AppBaselineOptions = {},
): AppUserConfig => {
  const {
    appId = 'app',
    enableBffRequestId = true,
    enableTelemetry = true,
    enableTelemetryExporters = true,
    otlpEndpoint = process.env.MODERN_TELEMETRY_OTLP_ENDPOINT ||
      'http://127.0.0.1:4318/v1/logs',
    victoriaMetricsEndpoint = process.env.MODERN_TELEMETRY_VICTORIA_ENDPOINT ||
      'http://127.0.0.1:8428/api/v1/import/prometheus',
    telemetryFailLoudStartup = true,
    enableModuleFederationSSR = true,
  } = options;

  const server: NonNullable<AppUserConfig['server']> = {};

  if (enableTelemetry) {
    server.telemetry = {
      enabled: true,
      failLoudStartup: telemetryFailLoudStartup,
    };

    if (enableTelemetryExporters) {
      server.telemetry.exporters = {
        otlp: {
          enabled: true,
          endpoint: otlpEndpoint,
        },
        victoriaMetrics: {
          enabled: true,
          endpoint: victoriaMetricsEndpoint,
        },
      };
    }
  }

  if (enableModuleFederationSSR) {
    server.ssr = {
      mode: 'stream',
      moduleFederationAppSSR: true,
    };
  }

  const baselineConfig: AppUserConfig = {
    output: {
      // Keep build artifacts predictable across apps.
      precompress: true,
    },
    performance: {
      // Keep diagnostics behavior consistent in production.
      rsdoctor: {
        enabled: process.env.NODE_ENV === 'production',
        disableClientServer: true,
      },
    },
    server,
    tools: {
      bundlerChain: setReactRouterBridgeSafeAliases,
    },
  };

  if (enableBffRequestId) {
    baselineConfig.bff = {
      requestId: appId,
    };
  }

  return baselineConfig;
};

export const withAppBaseline = (
  config: AppUserConfig,
  options: AppBaselineOptions = {},
): AppUserConfig =>
  mergeConfig([createAppBaselineConfig(options), config]) as AppUserConfig;
