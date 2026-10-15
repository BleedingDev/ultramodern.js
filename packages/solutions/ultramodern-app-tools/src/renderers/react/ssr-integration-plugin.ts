import type {
  AppTools,
  AppToolsNormalizedConfig,
  CliPlugin,
} from '@modern-js/app-tools';
import type { CLIPluginAPI } from '@modern-js/plugin';
import type { RsbuildPlugin } from '@rsbuild/core';

/**
 * Resolve application-wide SSR policy once from explicit configuration;
 * environment hooks only apply it. Module Federation SSR is
 * `server.ssr.moduleFederationAppSSR`; the federation plugin itself owns its
 * server bundle shape and uses the normal Rsbuild server splitting defaults.
 */
const normalizeSsrCapabilities = (config: AppToolsNormalizedConfig) => {
  const ssr = [
    config.server?.ssr,
    ...Object.values(config.server?.ssrByEntries ?? {}),
  ];
  const rendering = Boolean(
    config.output?.ssg ||
      Object.keys(config.output?.ssgByEntries ?? {}).length ||
      config.server?.ssr ||
      Object.keys(config.server?.ssrByEntries ?? {}).length,
  );
  return {
    federation:
      rendering &&
      ssr.some(
        value =>
          value &&
          typeof value === 'object' &&
          value.moduleFederationAppSSR === true,
      ),
    worker: config.deploy?.target === 'cloudflare',
  };
};

const MODERN_TARGET_DEFINE = 'process.env.MODERN_TARGET';
const IMPORT_META_MODERN_TARGET_DEFINE = 'import.meta.env.MODERN_TARGET';

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
      // Native SSR runs first and defines this environment's build target.
      // Mirror it on Rsbuild's import.meta.env: generated type checking
      // rejects process.env reads through Effect's processEnv diagnostic.
      const buildTarget = config.source.define?.[MODERN_TARGET_DEFINE];
      return mergeEnvironmentConfig(config, {
        source: {
          define: {
            'process.env.MODERN_MF_APP_SSR': JSON.stringify(
              String(capabilities.federation),
            ),
            ...(buildTarget === undefined
              ? {}
              : { [IMPORT_META_MODERN_TARGET_DEFINE]: buildTarget }),
          },
        },
        ...(name === 'workerSSR' && capabilities.worker
          ? { output: { module: true } }
          : {}),
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
