import { type AppTools, appTools, type CliPlugin } from '@modern-js/app-tools';
import { createBuilderGenerator } from '@modern-js/app-tools/builder';
import backendFederationBuildPlugin from '@modern-js/app-tools-extensions/backend-federation-build';
import { createCloudflareBuilderPlugin } from '@modern-js/app-tools-extensions/cloudflare-builder';
import {
  createDeployOutputAliasesPlugin,
  createDeployOutputPublicAssetsPlugin,
} from '@modern-js/app-tools-extensions/deploy-output/plugin';
import {
  createPolicyDefaultsPlugin,
  type PolicyDefaultsOptions,
  ULTRAMODERN_SERVER_EXTENSIONS_PLUGIN_NAME,
} from '@modern-js/app-tools-extensions/policy-defaults';
import { ultramodernI18nIntegrationPlugin } from '@modern-js/i18n-integration';
import { ultramodernReleaseEnvelopePlugin } from './release-envelope-plugin';
import { ultramodernRouterIntegrationPlugin } from './router-integration-plugin';
import { rscDisabledRuntimePlugin } from './rsc-disabled-plugin';
import { ultramodernSSRIntegrationPlugin } from './ssr-integration-plugin';

export {
  createPresetUltramodernConfig,
  type PresetUltramodernOptions,
  presetUltramodern,
} from './preset';
export { ultramodernReleaseEnvelopePlugin } from './release-envelope-plugin';
export type { AppUserConfig, UltramodernAppUserConfig } from './types';
export {
  createPresetUltramodernWorkspaceConfig,
  type PresetUltramodernWorkspaceOptions,
  presetUltramodernWorkspace,
} from './workspace-preset';
export type { PolicyDefaultsOptions };

const headlessCloudflareWorkerPlugin = (): CliPlugin<AppTools> => ({
  name: '@modern-js/headless-cloudflare-worker',
  post: ['@modern-js/ultramodern-release-envelope'],
  setup(api) {
    api.onAfterBuild(async () => {
      const appContext = api.getAppContext();
      if (
        !appContext.apiOnly ||
        appContext.deployTarget.target !== 'cloudflare'
      ) {
        return;
      }
      const normalizedConfig = api.getNormalizedConfig();

      // Native API-only builds intentionally skip their UI builder. Reuse the
      // same builder generator with the Cloudflare plugin's worker-only entry.
      const createBuilderForModern = await createBuilderGenerator();
      const builder = await createBuilderForModern({
        appContext,
        normalizedConfig,
      });
      // This compiler has only an Effect worker entry. The framework SSR
      // adapter filters page entries and requires a UI route, so it does not
      // apply to a headless API worker.
      builder.removePlugins(['builder-plugin-adapter-modern-ssr']);
      await builder.build();
    });
  },
});

/** Compose the fork's build and release features through native CLI plugins. */
export const ultramodernAppTools = (
  options: PolicyDefaultsOptions = {},
): CliPlugin<AppTools> => ({
  name: '@modern-js/ultramodern-app-tools',
  usePlugins: [
    appTools({
      ...options,
      rendererExtensions: false,
      serverExtensions: false,
    }),
    createPolicyDefaultsPlugin(options, {
      pluginName: '@modern-js/ultramodern-app-tools/policy-defaults',
      serverPluginName: ULTRAMODERN_SERVER_EXTENSIONS_PLUGIN_NAME,
      runtimePackages: ['@modern-js/i18n-integration'],
      registrarUrl: import.meta.url,
    }) as CliPlugin<AppTools>,
    ultramodernI18nIntegrationPlugin(),
    ultramodernRouterIntegrationPlugin(),
    ultramodernSSRIntegrationPlugin(),
    backendFederationBuildPlugin(),
    createCloudflareBuilderPlugin(),
    headlessCloudflareWorkerPlugin(),
    createDeployOutputAliasesPlugin(),
    createDeployOutputPublicAssetsPlugin(),
    ultramodernReleaseEnvelopePlugin(),
  ],
  setup(api) {
    api.modifyResolvedConfig(config => {
      const builderPlugins = [
        ...(config.builderPlugins ?? []),
        ...(config.server?.rsc ? [] : [rscDisabledRuntimePlugin()]),
      ];
      return { ...config, builderPlugins };
    });
  },
});
