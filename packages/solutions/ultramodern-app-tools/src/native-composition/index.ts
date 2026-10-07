import { appTools } from '@modern-js/app-tools';
import type { AppTools, CliPlugin } from '@modern-js/app-tools/cli-config';
import {
  createDeployOutputAliasesPlugin,
  createDeployOutputPublicAssetsPlugin,
} from '@modern-js/app-tools-extensions/deploy-output/plugin';
import type { PolicyDefaultsOptions } from '@modern-js/app-tools-extensions/policy-defaults';
import { rendererBuildArtifactStampPlugin } from '@modern-js/app-tools-extensions/release-envelope/renderer-output-stamp';
import { SERVICE_WORKER_ENVIRONMENT_NAME } from '@modern-js/builder';
import type { Renderer, RendererIdentity } from '@modern-js/renderer-core';
import type { NativeRendererAdapter } from '@modern-js/renderer-core/adapter';
import { createDefineConfig } from './config';
import { isEntryMetadataRead } from './config-read-context';
import { createRendererModuleFederationIntegration } from './module-federation-renderer-plugin';
import { nativeClientAssetsPlugin } from './native-assets';
import { createNativeEntryStubGenerator } from './native-entry';
import { nativeEntryCommandPlugin } from './native-entry-command';
import { findNativeI18nConfig } from './native-i18n';
import type { NativeEntryGenerator } from './native-infrastructure';
import { nativeRendererInfrastructurePlugin } from './native-infrastructure';
import { nativeModuleFederationPlugin } from './native-module-federation';
import { nativePrerenderPlugin } from './native-prerender';
import { ultramodernReleaseEnvelopePlugin } from './release-envelope-plugin';
import { createRendererBuildOutputResolver } from './renderer-build-output';
import { createRendererBuildIdentityResolver } from './renderer-build-resolution';
import {
  nativeInfrastructurePluginName,
  resolveRendererAdapter,
} from './renderer-registration';
import {
  assertRendererCompilerOwnership,
  attachRendererCompilerClaim,
  nativeRendererIsolationPlugin,
  rendererSelectionGuard,
  resolveRendererBuilderPlugins,
} from './renderer-selection';
import { nativeSvgComponentsPlugin } from './svg-components';
import { rendererTypeCheckerPlugin } from './type-checker';

export {
  type ConfigParams,
  type LoadUltramodernConfigOptions,
  loadUltramodernConfig,
  loadUltramodernConfigFile,
  resolveUltramodernConfig,
  resolveUltramodernEntryIdentities,
  type UserConfigExport,
} from './config';
export {
  RENDERER_BUILD_MANIFEST_FILE,
  RENDERER_DEVELOPMENT_DIRECTORY,
  type RendererBuildManifest,
  type RendererDevelopmentBuildManifest,
  type RendererDevelopmentCompilation,
  readRendererBuildManifest,
  readRendererDevelopmentBuildManifest,
  validateRendererBuildManifest,
  validateRendererDevelopmentBuildManifest,
} from './native-build-manifest';
export {
  i18nPlugin,
  type NativeI18nBackendOptions,
  type NativeI18nLocaleDetection,
  type NativeI18nPluginOptions,
} from './native-i18n';
export {
  createPresetUltramodernConfig,
  type PresetUltramodernOptions,
  presetUltramodern,
} from './preset';
export { ultramodernReleaseEnvelopePlugin } from './release-envelope-plugin';
export {
  type RegisteredRenderer,
  type RendererBuildProfile,
  registeredRenderers,
  resolveCandidateRendererProfile,
  resolveRendererProfile,
  resolveRendererRouterFrameworks,
} from './renderer-profile';
export {
  resolveRendererAdapter,
  specifierRenderer,
  type UltramodernRendererAdapter,
} from './renderer-registration';
export type { AppUserConfig, UltramodernAppUserConfig } from './types';
export {
  createPresetUltramodernWorkspaceConfig,
  type PresetUltramodernWorkspaceOptions,
  presetUltramodernWorkspace,
} from './workspace-preset';
export type { PolicyDefaultsOptions };

function composeNativeRenderer(
  adapter: NativeRendererAdapter,
  consumerPlugins: readonly CliPlugin<AppTools>[],
): CliPlugin<AppTools> {
  const renderer = adapter.name;
  const infrastructurePluginName = nativeInfrastructurePluginName(renderer);
  let rendererIdentities: Readonly<Record<string, RendererIdentity>> = {};
  const resolveBuildIdentities = createRendererBuildIdentityResolver(renderer);
  let generator: NativeEntryGenerator | undefined;
  const resolveGenerator = () =>
    (generator ??= createNativeEntryStubGenerator(adapter));
  const federation = createRendererModuleFederationIntegration(renderer);
  const selected = [
    appTools({ rendererExtensions: false, serverExtensions: false }),
    rendererTypeCheckerPlugin(renderer),
    nativeEntryCommandPlugin(),
    nativeRendererInfrastructurePlugin(
      renderer,
      {
        async client(context) {
          return (await resolveGenerator()).client(context);
        },
        async server(context) {
          return (await resolveGenerator()).server(context);
        },
      },
      {
        adapter,
        i18n: findNativeI18nConfig(consumerPlugins),
        async resolveBuildIdentities(context) {
          const resolved = await resolveBuildIdentities(context);
          if (
            context.mode !== 'development' ||
            !Object.keys(rendererIdentities).length
          ) {
            rendererIdentities = resolved.identities;
            federation.controller.onBuildIdentities(resolved);
          }
          return resolved;
        },
      },
    ),
    {
      ...rendererBuildArtifactStampPlugin({
        rendererBuildPlugin: infrastructurePluginName,
        resolveRendererBuild: createRendererBuildOutputResolver(renderer),
      }),
      post: ['@modern-js/ultramodern-release-envelope'],
    },
    ...(adapter.profile.capabilities.ssg
      ? [nativePrerenderPlugin(adapter)]
      : []),
    nativeModuleFederationPlugin(renderer),
    federation.plugin,
    createDeployOutputAliasesPlugin(),
    createDeployOutputPublicAssetsPlugin(),
    ultramodernReleaseEnvelopePlugin(renderer),
  ];
  return {
    name: '@modern-js/ultramodern-app-tools',
    usePlugins: [
      rendererSelectionGuard(renderer, selected, consumerPlugins, true),
      ...selected,
    ],
    setup(api) {
      if (!isEntryMetadataRead())
        api.modifyResolvedConfig(async config => {
          const svgComponents =
            adapter.profile.capabilities.svgComponent &&
            adapter.svgComponentTemplate;
          // The adapter compiles sources; UltraModern owns SVG and ownership.
          const compiler = attachRendererCompilerClaim(
            adapter.compiler({
              rendererIdentities: () => rendererIdentities,
              workerEnvironmentName: SERVICE_WORKER_ENVIRONMENT_NAME,
            }),
            {
              renderer,
              sourceExtensions: adapter.profile.sourceExtensions,
              transform: 'native',
              refresh: 'native',
              svg: svgComponents ? 'component' : 'url',
            },
          );
          const builderPlugins = [
            nativeRendererIsolationPlugin(renderer),
            nativeClientAssetsPlugin(
              renderer,
              () => rendererIdentities,
              adapter.lazyStyles,
            ),
            compiler,
            ...(svgComponents
              ? [
                  nativeSvgComponentsPlugin({
                    renderer,
                    template: svgComponents,
                    defaultExport: config.output?.svgDefaultExport,
                  }),
                ]
              : []),
            ...(await resolveRendererBuilderPlugins(
              config.builderPlugins ?? [],
            )),
          ];
          assertRendererCompilerOwnership(renderer, builderPlugins);
          return { ...config, builderPlugins };
        });
      api._internalRuntimePlugins(({ entrypoint, plugins }) => {
        if (plugins.length) {
          throw new Error(
            `Renderer ${renderer} does not support React runtime descriptors: ${plugins.map(plugin => plugin.path).join(', ')}`,
          );
        }
        return { entrypoint, plugins };
      });
    },
  };
}

/** Compose the fork's build and release features through native CLI plugins. */
const composeUltramodernAppTools = (
  options: {
    renderer?: Renderer;
    consumerPlugins?: readonly CliPlugin<AppTools>[];
    policy?: PolicyDefaultsOptions;
  } = {},
): CliPlugin<AppTools> => {
  const adapter = resolveRendererAdapter(options.renderer);
  const consumers = options.consumerPlugins ?? [];
  return adapter.kind === 'native'
    ? composeNativeRenderer(adapter, consumers)
    : adapter.compose(consumers, options.policy);
};

/**
 * The explicit default base is React; renderer selection belongs to config.
 * `policy` opts out of the fork's React renderer or server policy.
 */
export const ultramodernAppTools = (
  policy: PolicyDefaultsOptions = {},
): CliPlugin<AppTools> =>
  composeUltramodernAppTools({ renderer: 'react', policy });

/** Select one base plugin graph during config evaluation, before registration. */
export const defineConfig = createDefineConfig((renderer, consumerPlugins) =>
  composeUltramodernAppTools({ renderer, consumerPlugins }),
);
