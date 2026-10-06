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
import { runtimePlugin } from '@modern-js/runtime/cli';
import type { ConfigSourceSnapshot } from './config-evaluator/source-snapshot';
import { getConfigurationSourceSnapshot } from './configuration-read-context';
import { ultramodernModuleFederationRecoveryPlugin } from './module-federation-recovery-plugin';
import { createReactModuleFederationRendererIntegration } from './module-federation-renderer-plugin';
import { nativeEntryCommandPlugin } from './native-entry-command';
import { reactRendererBuildMetadataPlugin } from './react-build-metadata';
import { createReactReceiverOutputIntegration } from './react-mf-dts-outputs';
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
  snapshot: ConfigSourceSnapshot | undefined,
  registrarUrl = import.meta.url,
): string {
  if (!snapshot)
    throw new Error(
      'React server plugin requires the original configuration source snapshot',
    );
  return resolveSdkServerPlugin(
    appDirectory,
    'server-plugin',
    registrarUrl,
    snapshot,
  );
}

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

/** Existing React composition, loaded only when React is selected. */
export const composeReactRenderer = (
  options: {
    consumerPlugins?: readonly CliPlugin<AppTools>[];
    policy?: PolicyDefaultsOptions;
  } = {},
): CliPlugin<AppTools> => {
  const policy = options.policy ?? {};
  const receiverOutputs = createReactReceiverOutputIntegration();
  const federationRenderer = createReactModuleFederationRendererIntegration();
  const selected = [
    nativeEntryCommandPlugin(),
    appTools({
      ...policy,
      rendererExtensions: false,
      serverExtensions: false,
    }),
    // The fork's renderer and server policy belong to this composition, which
    // also hosts the runtime packages it registers.
    createPolicyDefaultsPlugin(policy, {
      pluginName: '@modern-js/ultramodern-app-tools/policy-defaults',
      serverPluginName: ULTRAMODERN_SERVER_EXTENSIONS_PLUGIN_NAME,
      runtimePackages: ['@modern-js/i18n-integration'],
      registrarUrl: import.meta.url,
    }) as CliPlugin<AppTools>,
    rendererTypeCheckerPlugin('react'),
    runtimePlugin(),
    receiverOutputs.plugin,
    reactRendererBuildMetadataPlugin({
      resolveBuildIdentities: createRendererBuildIdentityResolver('react'),
      generatedOutputs: receiverOutputs.controller,
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
    createDeployOutputPublicAssetsPlugin(),
    ultramodernReleaseEnvelopePlugin(),
  ];
  return {
    name: '@modern-js/ultramodern-app-tools',
    usePlugins: [
      rendererSelectionGuard('react', selected, options.consumerPlugins, true),
      ...selected,
    ],
    setup(api) {
      api.modifyResolvedConfig(config => {
        const builderPlugins = [
          ...(config.builderPlugins ?? []),
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
            getConfigurationSourceSnapshot(api),
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
