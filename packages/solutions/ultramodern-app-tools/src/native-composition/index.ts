import { type AppTools, appTools, type CliPlugin } from '@modern-js/app-tools';
import { createBuilderGenerator } from '@modern-js/app-tools/builder';
import backendFederationBuildPlugin from '@modern-js/app-tools-extensions/backend-federation-build';
import { createCloudflareBuilderPlugin } from '@modern-js/app-tools-extensions/cloudflare-builder';
import {
  createDeployOutputAliasesPlugin,
  createDeployOutputPublicAssetsPlugin,
} from '@modern-js/app-tools-extensions/deploy-output/plugin';
import { resolveDeployTarget } from '@modern-js/app-tools-extensions/deploy-output/target';
import {
  RENDERER_EXTENSIONS_PACKAGE,
  SERVER_EXTENSIONS_PLUGIN_NAME,
} from '@modern-js/app-tools-extensions/policy-defaults';
import {
  collectRuntimePackageModuleDirectories,
  createRuntimePackageResolutionPlugin,
} from '@modern-js/app-tools-extensions/runtime-package-resolution';
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

const headlessCloudflareWorkerPlugin = (): CliPlugin<AppTools> => ({
  name: '@modern-js/headless-cloudflare-worker',
  post: ['@modern-js/ultramodern-release-envelope'],
  setup(api) {
    api.onAfterBuild(async () => {
      const appContext = api.getAppContext();
      const normalizedConfig = api.getNormalizedConfig();
      if (
        !appContext.apiOnly ||
        resolveDeployTarget(normalizedConfig) !== 'cloudflare'
      ) {
        return;
      }

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
export const ultramodernAppTools = (): CliPlugin<AppTools> => ({
  name: '@modern-js/ultramodern-app-tools',
  usePlugins: [
    appTools(),
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
    // The composed runtime packages are dependencies of this package, not of
    // the app that composes it. Contribute the directories that host them so
    // the generated `runtime-register.js` resolves them under an isolated
    // (pnpm) linker without the app having to declare them itself.
    const runtimeModuleDirectories = collectRuntimePackageModuleDirectories(
      [RENDERER_EXTENSIONS_PACKAGE, '@modern-js/i18n-integration'],
      import.meta.url,
    );

    api.modifyResolvedConfig(config => {
      const builderPlugins = [
        ...(config.builderPlugins ?? []),
        ...(runtimeModuleDirectories.length > 0
          ? [createRuntimePackageResolutionPlugin(runtimeModuleDirectories)]
          : []),
        ...(config.server?.rsc ? [] : [rscDisabledRuntimePlugin()]),
      ];
      return { ...config, builderPlugins };
    });
    api._internalServerPlugins(({ plugins }) => {
      // `appTools()` already registered the fork's server policy under its own
      // specifier. An app that composes this package declares *this* package,
      // so the descriptor is renamed rather than duplicated: both specifiers
      // export the same server plugin, and this one is the one such an app can
      // always resolve.
      const name = '@modern-js/ultramodern-app-tools/server-plugin';
      const renamed = plugins.map(plugin =>
        plugin.name === SERVER_EXTENSIONS_PLUGIN_NAME
          ? { ...plugin, name }
          : plugin,
      );
      if (!renamed.some(plugin => plugin.name === name)) {
        renamed.push({ name });
      }
      return { plugins: renamed };
    });
    api._internalRuntimePlugins(({ entrypoint, plugins }) => {
      // Same story for the renderer descriptor: `appTools()` already appended
      // it unless the app opted out.
      if (
        !plugins.some(plugin => plugin.path === RENDERER_EXTENSIONS_PACKAGE)
      ) {
        plugins.push({
          name: 'rendererHead',
          path: RENDERER_EXTENSIONS_PACKAGE,
          config: {},
        });
      }
      return { entrypoint, plugins };
    });
  },
});
