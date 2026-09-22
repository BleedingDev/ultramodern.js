// @effect-diagnostics globalConsole:off processEnv:off strictBooleanExpressions:off
import type {
  AppTools,
  AppToolsNormalizedConfig,
  CliPlugin,
} from '@modern-js/app-tools';
import type { CLIPluginAPI } from '@modern-js/plugin';
import type { MergedEnvironmentConfig, RsbuildPlugin } from '@rsbuild/core';

type EnvironmentConfigLike = Partial<
  Pick<MergedEnvironmentConfig, 'output' | 'source' | 'tools'>
>;

/** Translate supported MF integration markers at the builder boundary. */
const hasModuleFederationMarker = (
  config: EnvironmentConfigLike,
  projectMarker: boolean,
): boolean => {
  if (projectMarker) return true;
  const define = config.source?.define ?? {};
  if ('REMOTE_IP_STRATEGY' in define || 'FEDERATION_IPV4' in define)
    return true;

  const rspack = config.tools?.rspack;
  return (Array.isArray(rspack) ? rspack : [rspack]).some(entry => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      !('plugins' in entry) ||
      !Array.isArray(entry.plugins)
    )
      return false;
    return entry.plugins.some((input: unknown) => {
      const plugin = Array.isArray(input) ? input[0] : input;
      if (!plugin) return false;
      const name =
        typeof plugin === 'string'
          ? plugin
          : typeof plugin === 'function'
            ? plugin.name
            : typeof plugin === 'object'
              ? (plugin as { name?: string }).name || plugin.constructor?.name
              : undefined;
      return typeof name === 'string' && /modulefederation/i.test(name);
    });
  });
};

/** Resolve application-wide SSR policy once; environment hooks only apply it. */
const normalizeSsrCapabilities = (config: AppToolsNormalizedConfig) => {
  const ssr = [
    config.server?.ssr,
    ...Object.values(config.server?.ssrByEntries ?? {}),
  ];
  return {
    rendering: Boolean(
      config.output?.ssg ||
        Object.keys(config.output?.ssgByEntries ?? {}).length ||
        config.server?.ssr ||
        Object.keys(config.server?.ssrByEntries ?? {}).length,
    ),
    federation: ssr.some(
      value =>
        value &&
        typeof value === 'object' &&
        value.moduleFederationAppSSR === true,
    ),
    worker: config.deploy?.target === 'cloudflare',
    projectMarker: process.env.MF_SSR_PRJ === 'true',
    requireExplicit: process.env.MODERN_MF_APP_SSR_REQUIRE_EXPLICIT === 'true',
  };
};

const isNodeEnvironmentTarget = (target: unknown): boolean =>
  typeof target === 'string' &&
  (target === 'node' || target === 'async-node' || target.startsWith('node'));

export const shouldUseModuleFederationNodeOutput = (
  config: EnvironmentConfigLike,
): boolean =>
  isNodeEnvironmentTarget(config.output?.target) &&
  hasModuleFederationMarker(config, process.env.MF_SSR_PRJ === 'true');

const ssrIntegrationBuilderPlugin = (
  modernAPI: CLIPluginAPI<AppTools>,
): RsbuildPlugin => ({
  name: '@modern-js/ultramodern-builder-plugin-ssr',
  pre: ['@modern-js/builder-plugin-ssr'],
  setup(api) {
    const capabilities = normalizeSsrCapabilities(
      modernAPI.getNormalizedConfig(),
    );
    api.modifyEnvironmentConfig((config, { name, mergeEnvironmentConfig }) => {
      const isServerEnvironment =
        isNodeEnvironmentTarget(config.output.target) || name === 'workerSSR';
      const hasModuleFederationRuntimeMarker =
        capabilities.rendering &&
        isNodeEnvironmentTarget(config.output.target) &&
        hasModuleFederationMarker(config, capabilities.projectMarker);

      if (
        capabilities.rendering &&
        hasModuleFederationRuntimeMarker &&
        !capabilities.federation
      ) {
        const warningMessage =
          '[modernjs][mf-ssr] Module Federation SSR was auto-detected from runtime markers. Set server.ssr.moduleFederationAppSSR=true explicitly in host and remotes to avoid heuristic drift.';
        if (capabilities.requireExplicit) {
          throw new Error(
            `${warningMessage} (enforced by MODERN_MF_APP_SSR_REQUIRE_EXPLICIT=true)`,
          );
        }
        // eslint-disable-next-line no-console
        console.warn(warningMessage);
      }
      const isModuleFederationAppSSR =
        capabilities.rendering && capabilities.federation;
      return mergeEnvironmentConfig(config, {
        source: {
          define: {
            'process.env.MODERN_MF_APP_SSR': JSON.stringify(
              String(isModuleFederationAppSSR),
            ),
          },
        },
        ...(name === 'workerSSR' && capabilities.worker
          ? { output: { module: true } }
          : {}),
        splitChunks:
          isServerEnvironment &&
          (hasModuleFederationRuntimeMarker || capabilities.federation)
            ? false
            : undefined,
      });
    });
  },
});

/** Apply fork SSR policy after native SSR defaults through Rsbuild hooks. */
export const ultramodernSSRIntegrationPlugin = (): CliPlugin<AppTools> => ({
  name: '@modern-js/ultramodern-ssr-integration',
  setup(api) {
    api.config(() => ({ builderPlugins: [ssrIntegrationBuilderPlugin(api)] }));
  },
});
