import { createRequire } from 'node:module';
import path from 'node:path';
import { type AppTools, appTools, type CliPlugin } from '@modern-js/app-tools';
import { createBuilderGenerator } from '@modern-js/app-tools/builder';
import backendFederationBuildPlugin from '@modern-js/app-tools-extensions/backend-federation-build';
import { createCloudflareBuilderPlugin } from '@modern-js/app-tools-extensions/cloudflare-builder';
import { createDeployOutputAliasesPlugin } from '@modern-js/app-tools-extensions/deploy-output/plugin';
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
import { runtimePlugin } from '@modern-js/runtime/cli';
import { ultramodernModuleFederationRecoveryPlugin } from './module-federation-recovery-plugin';
import { createReactModuleFederationRendererIntegration } from './module-federation-renderer-plugin';
import { nativeEntryCommandPlugin } from './native-entry-command';
import { reactRendererBuildMetadataPlugin } from './react-build-metadata';
import { createReactRscWorkerIntegrationPlugin } from './react-rsc-worker-integration';
import { ultramodernReleaseEnvelopePlugin } from './release-envelope-plugin';
import { createRendererBuildOutputResolver } from './renderer-build-output';
import { createRendererBuildIdentityResolver } from './renderer-build-resolution';
import { rendererSelectionGuard } from './renderer-selection';
import { ultramodernRouterIntegrationPlugin } from './router-integration-plugin';
import { rscDisabledRuntimePlugin } from './rsc-disabled-plugin';
import { resolveSdkServerPlugin } from './server-plugin-resolution';
import { ultramodernSSRIntegrationPlugin } from './ssr-integration-plugin';
import { rendererTypeCheckerPlugin } from './type-checker';

export type { ReactCLIElement } from './react-types';

/** A portable application import of this exact SDK owner's public server export. */
export function resolveReactServerPlugin(
  appDirectory: string,
  registrarUrl = import.meta.url,
): string {
  return resolveSdkServerPlugin(appDirectory, 'server-plugin', registrarUrl);
}

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

/** Existing React composition, loaded only when React is selected. */
export const composeReactRenderer = (
  options: { consumerPlugins?: readonly CliPlugin<AppTools>[] } = {},
): CliPlugin<AppTools> => {
  const policy = options.policy ?? {};
  const federationRenderer = createReactModuleFederationRendererIntegration();
  const selected = [
    nativeEntryCommandPlugin(),
    appTools(),
    rendererTypeCheckerPlugin('react'),
    runtimePlugin(),
    reactRendererBuildMetadataPlugin({
      resolveBuildIdentities: createRendererBuildIdentityResolver('react'),
      onBuildIdentities: federationRenderer.controller.onBuildIdentities,
    }),
    ultramodernI18nIntegrationPlugin(),
    ultramodernRouterIntegrationPlugin(),
    ultramodernSSRIntegrationPlugin(),
    ultramodernModuleFederationRecoveryPlugin(),
    federationRenderer.plugin,
    backendFederationBuildPlugin({
      rendererBuildPlugin: '@modern-js/renderer-react-build-metadata',
      resolveRendererBuild: createRendererBuildOutputResolver('react'),
    }),
    createCloudflareBuilderPlugin(),
    createReactRscWorkerIntegrationPlugin(),
    headlessCloudflareWorkerPlugin(),
    createDeployOutputAliasesPlugin(),
    ultramodernReleaseEnvelopePlugin(),
  ];
  return {
    name: '@modern-js/ultramodern-app-tools',
    usePlugins: [
      rendererSelectionGuard('react', selected, options.consumerPlugins, true),
      ...selected,
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
      if (policy.serverExtensions !== false) {
        api._internalServerPlugins(({ plugins }) => {
          // Preserve a public import for generated deploy handlers, including
          // applications that declare the mapped SDK without its canonical alias.
          const name = resolveReactServerPlugin(
            api.getAppContext().appDirectory,
          );
          return {
            plugins: plugins.map(plugin =>
              plugin.name === ULTRAMODERN_SERVER_EXTENSIONS_PLUGIN_NAME
                ? { ...plugin, name }
                : plugin,
            ),
          };
        });
      }
    },
  };
};
