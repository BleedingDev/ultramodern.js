import fs from 'node:fs';
import path from 'node:path';
import { resolveUltramodernReleaseIdentity } from '@modern-js/app-tools-extensions/release-identity';
import { mergeConfig } from '@modern-js/plugin/cli';
import { type RspackChain, rspack } from '@rsbuild/core';
import type { AppUserConfig } from './types';

export { default as ultramodernReleaseEnvelopePlugin } from './plugins/ultramodernReleaseEnvelope';

const DEFAULT_OTLP_ENDPOINT = 'http://127.0.0.1:4318/v1/logs';
const DEFAULT_VICTORIA_METRICS_ENDPOINT =
  'http://127.0.0.1:8428/api/v1/import/prometheus';

export interface PresetUltramodernOptions {
  /**
   * Stable producer identity used by BFF cross-project clients.
   * @default "app"
   */
  appId?: string;
  /**
   * Generation-time identity root for a generated delivery unit. When set, the
   * preset derives one build identity from the immutable source revision and
   * injects it into every browser, SSR, API, and backend bundle.
   */
  deliveryUnit?: {
    buildMarker: string;
    unitId: string;
    version: string;
  };
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
   * Enable telemetry exporters.
   *
   * By default each exporter is enabled only when its endpoint is explicitly
   * configured (via the matching option or environment variable), so a bare
   * preset app boots in production without local collectors.
   * Set `true` to force both exporters on with their default localhost
   * endpoints, or `false` to disable exporters entirely.
   * @default undefined (endpoint-driven)
   */
  enableTelemetryExporters?: boolean;
  /**
   * OTLP exporter endpoint. Setting it (or the environment variable)
   * enables the OTLP exporter unless `enableTelemetryExporters` is `false`.
   * The localhost endpoint is used only when exporters are forced on with
   * `enableTelemetryExporters: true` and no endpoint was provided.
   * @default process.env.MODERN_TELEMETRY_OTLP_ENDPOINT
   */
  otlpEndpoint?: string;
  /**
   * VictoriaMetrics exporter endpoint. Setting it (or the environment
   * variable) enables the VictoriaMetrics exporter unless
   * `enableTelemetryExporters` is `false`.
   * The localhost endpoint is used only when exporters are forced on with
   * `enableTelemetryExporters: true` and no endpoint was provided.
   * @default process.env.MODERN_TELEMETRY_VICTORIA_ENDPOINT
   */
  victoriaMetricsEndpoint?: string;
  /**
   * Enable fail-loud startup probing for telemetry exporters.
   * Probes only run for exporters that are actually enabled.
   * @default false
   */
  telemetryFailLoudStartup?: boolean;
  /**
   * Enable app-level Module Federation SSR handshake by default.
   * @default true
   */
  enableModuleFederationSSR?: boolean;
}

const resolveReactRouterPackageDir = (appDirectory: string) => {
  const resolveNodeModulePackageJson = (
    packageName: string,
    fromDirectory: string,
  ) => {
    let currentDirectory = path.resolve(fromDirectory);

    while (true) {
      const packageJson = path.join(
        currentDirectory,
        'node_modules',
        packageName,
        'package.json',
      );
      if (fs.existsSync(packageJson)) {
        return fs.realpathSync(packageJson);
      }

      const parentDirectory = path.dirname(currentDirectory);
      if (parentDirectory === currentDirectory) {
        return undefined;
      }
      currentDirectory = parentDirectory;
    }
  };

  const reactRouterPackageJson = resolveNodeModulePackageJson(
    'react-router',
    appDirectory,
  );
  if (reactRouterPackageJson) {
    return path.dirname(reactRouterPackageJson);
  }

  const reactRouterDomPackageJson = resolveNodeModulePackageJson(
    'react-router-dom',
    appDirectory,
  );
  if (!reactRouterDomPackageJson) {
    return undefined;
  }

  const nestedReactRouterPackageJson = resolveNodeModulePackageJson(
    'react-router',
    path.dirname(reactRouterDomPackageJson),
  );
  if (nestedReactRouterPackageJson) {
    return path.dirname(nestedReactRouterPackageJson);
  }

  return undefined;
};

// Dependency-driven opt-in surface for apps that explicitly install
// react-router/react-router-dom. Default TanStack workspaces install neither,
// so resolveReactRouterPackageDir returns undefined and this must no-op.
// Do not remove as dead code: it is the supported escape hatch for apps that
// bring their own react-router dependency.
const setReactRouterBridgeSafeAliases = (
  chain: RspackChain,
  { isProd }: { isProd: boolean },
) => {
  const chainContext = chain.get('context');
  const appDirectory =
    typeof chainContext === 'string' && chainContext.length > 0
      ? chainContext
      : process.cwd();
  const reactRouterPackageDir = resolveReactRouterPackageDir(appDirectory);
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

  chain.resolve.alias.set(
    'react-router$',
    isProd ? productionEntry : developmentEntry,
  );
  chain.resolve.alias.set(
    'react-router/dist/production/index.js',
    productionEntry,
  );
  chain.resolve.alias.set(
    'react-router/dist/development/index.js',
    developmentEntry,
  );
};

/**
 * Materialize a fresh UltraModern preset config.
 *
 * This is the advanced inspection API. Use `presetUltramodern` when composing
 * an application config so nested records, arrays, and hooks keep the normal
 * Modern.js merge behavior.
 */
export const createPresetUltramodernConfig = (
  options: PresetUltramodernOptions = {},
): AppUserConfig => {
  const {
    appId = 'app',
    deliveryUnit,
    enableBffRequestId = true,
    enableTelemetry = true,
    enableTelemetryExporters,
    otlpEndpoint = process.env.MODERN_TELEMETRY_OTLP_ENDPOINT,
    victoriaMetricsEndpoint = process.env.MODERN_TELEMETRY_VICTORIA_ENDPOINT,
    telemetryFailLoudStartup = false,
    enableModuleFederationSSR = true,
  } = options;

  const server: NonNullable<AppUserConfig['server']> = {};
  const releaseIdentity = deliveryUnit
    ? resolveUltramodernReleaseIdentity({
        generationBuildMarker: deliveryUnit.buildMarker,
        unitId: deliveryUnit.unitId,
      })
    : undefined;
  const bundledReleaseIdentity = releaseIdentity
    ? {
        ...releaseIdentity,
        releaseVersion: deliveryUnit!.version,
      }
    : undefined;

  if (enableTelemetry) {
    server.telemetry = {
      enabled: true,
      failLoudStartup: telemetryFailLoudStartup,
    };

    if (enableTelemetryExporters !== false) {
      const exporters: NonNullable<
        NonNullable<typeof server.telemetry>['exporters']
      > = {};

      if (enableTelemetryExporters === true || otlpEndpoint) {
        exporters.otlp = {
          enabled: true,
          endpoint: otlpEndpoint || DEFAULT_OTLP_ENDPOINT,
        };
      }

      if (enableTelemetryExporters === true || victoriaMetricsEndpoint) {
        exporters.victoriaMetrics = {
          enabled: true,
          endpoint:
            victoriaMetricsEndpoint || DEFAULT_VICTORIA_METRICS_ENDPOINT,
        };
      }

      if (Object.keys(exporters).length > 0) {
        server.telemetry.exporters = exporters;
      }
    }
  }

  if (enableModuleFederationSSR) {
    server.ssr = {
      mode: 'stream',
      moduleFederationAppSSR: true,
    };
  }

  const presetConfig: AppUserConfig = {
    output: {
      // Keep build artifacts predictable across apps.
      precompress: true,
    },
    server,
    source: {
      reactCompiler: true,
      ...(deliveryUnit
        ? {
            globalVars: {
              ULTRAMODERN_BUILD_MARKER: releaseIdentity?.buildMarker,
              ULTRAMODERN_RELEASE_VERSION: deliveryUnit.version,
              ULTRAMODERN_SOURCE_REVISION: releaseIdentity?.sourceRevision,
            },
          }
        : {}),
    },
    tools: {
      bundlerChain: setReactRouterBridgeSafeAliases,
      // Keep generated Tailwind apps on Rsbuild's native CSS pipeline.
      lightningcssLoader: true,
      ...(bundledReleaseIdentity
        ? {
            rspack: config => {
              config.plugins ??= [];
              config.plugins.push(
                new rspack.BannerPlugin({
                  banner: `void ${JSON.stringify(bundledReleaseIdentity.buildMarker)};void ${JSON.stringify(bundledReleaseIdentity.sourceRevision)};void ${JSON.stringify(bundledReleaseIdentity.releaseVersion)};`,
                  raw: true,
                  // The default additions stage runs before production
                  // minimization, which removes side-effect-free identity
                  // expressions from browser and Module Federation assets.
                  // Inject after minimization but before Rspack derives asset
                  // hashes, so the identity survives in browser assets and a
                  // changed identity necessarily changes [contenthash].
                  stage: rspack.Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE,
                  test: /\.(?:c|m)?js$/u,
                }),
              );
              return config;
            },
          }
        : {}),
    },
  };

  if (enableBffRequestId) {
    presetConfig.bff = {
      requestId: appId,
    };
  }

  return presetConfig;
};

/**
 * Compose an application config over the UltraModern preset.
 *
 * The application config is merged after the preset. Nested records are
 * preserved, scalar values and `false` override preset values, and omitted or
 * `undefined` values keep the preset value. Arrays and hooks compose in
 * preset-first order. An empty record does not reset nested preset defaults;
 * use the typed `PresetUltramodernOptions` opt-outs instead.
 */
export const presetUltramodern = (
  config: AppUserConfig,
  options: PresetUltramodernOptions = {},
): AppUserConfig =>
  mergeConfig([
    createPresetUltramodernConfig(options),
    config,
  ]) as AppUserConfig;
