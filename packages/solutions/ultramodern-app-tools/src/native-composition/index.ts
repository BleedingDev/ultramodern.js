import { appTools } from '@modern-js/app-tools';
import type { AppTools, CliPlugin } from '@modern-js/app-tools/cli-config';
import { createDeployOutputAliasesPlugin } from '@modern-js/app-tools-extensions/deploy-output/plugin';
import { rendererBuildArtifactStampPlugin } from '@modern-js/app-tools-extensions/release-envelope/renderer-output-stamp';
import type { Renderer, RendererIdentity } from '@modern-js/renderer-core';
import { createDefineConfig } from './config';
import { nativeClientAssetsPlugin } from './native-assets';
import { nativeEntryCommandPlugin } from './native-entry-command';
import type { NativeEntryGenerator } from './native-infrastructure';
import { nativeRendererInfrastructurePlugin } from './native-infrastructure';
import { ultramodernReleaseEnvelopePlugin } from './release-envelope-plugin';
import { createRendererBuildOutputResolver } from './renderer-build-output';
import { createRendererBuildIdentityResolver } from './renderer-build-resolution';
import {
  type RendererRegistration,
  resolveRendererRegistration,
} from './renderer-registration';
import {
  assertRendererCompilerOwnership,
  nativeRendererIsolationPlugin,
  rendererSelectionGuard,
  resolveRendererBuilderPlugins,
} from './renderer-selection';
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
export type { AppUserConfig, UltramodernAppUserConfig } from './types';
export {
  createPresetUltramodernWorkspaceConfig,
  type PresetUltramodernWorkspaceOptions,
  presetUltramodernWorkspace,
} from './workspace-preset';
export type { PolicyDefaultsOptions };

function composeNativeRenderer(
  registration: Extract<RendererRegistration, { kind: 'native' }>,
  consumerPlugins: readonly CliPlugin<AppTools>[],
): CliPlugin<AppTools> {
  const adapter = registration.nativeAdapter;
  const renderer = registration.renderer;
  let rendererIdentities: Readonly<Record<string, RendererIdentity>> = {};
  const resolveBuildIdentities = createRendererBuildIdentityResolver(renderer);
  let generator: NativeEntryGenerator | undefined;
  const resolveGenerator = () => (generator ??= adapter.createEntryGenerator());
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
        infrastructurePluginName: adapter.infrastructurePluginName,
        compilerArtifacts: adapter.compilerArtifacts,
        assertSupportedSource: adapter.assertSupportedSource,
        async resolveBuildIdentities(context) {
          const resolved = await resolveBuildIdentities(context);
          if (
            context.mode !== 'development' ||
            !Object.keys(rendererIdentities).length
          )
            rendererIdentities = resolved.identities;
          return resolved;
        },
      },
    ),
    {
      ...rendererBuildArtifactStampPlugin({
        rendererBuildPlugin: adapter.infrastructurePluginName,
        resolveRendererBuild: createRendererBuildOutputResolver(renderer),
      }),
      post: ['@modern-js/ultramodern-release-envelope'],
    },
    createDeployOutputAliasesPlugin(),
    ultramodernReleaseEnvelopePlugin(renderer),
  ];
  return {
    name: '@modern-js/ultramodern-app-tools',
    usePlugins: [
      rendererSelectionGuard(renderer, selected, consumerPlugins, true),
      ...selected,
    ],
    setup(api) {
      api.modifyResolvedConfig(async config => {
        const compiler = await adapter.createCompiler({
          rendererIdentities: () => rendererIdentities,
        });
        const builderPlugins = [
          nativeRendererIsolationPlugin(renderer),
          nativeClientAssetsPlugin(renderer, () => rendererIdentities),
          compiler,
          ...(await resolveRendererBuilderPlugins(config.builderPlugins ?? [])),
        ];
        assertRendererCompilerOwnership(renderer, builderPlugins);
        return { ...config, builderPlugins };
      });
      api._internalRuntimePlugins(({ entrypoint, plugins }) => {
        if (!registration.supports.reactRuntimeDescriptors && plugins.length) {
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
  } = {},
): CliPlugin<AppTools> => {
  const registration = resolveRendererRegistration(options.renderer);
  const consumers = options.consumerPlugins ?? [];
  return registration.kind === 'native'
    ? composeNativeRenderer(registration, consumers)
    : registration.compose(consumers);
};

/** The explicit default base is React; renderer selection belongs to config. */
export const ultramodernAppTools = (): CliPlugin<AppTools> =>
  composeUltramodernAppTools({ renderer: 'react' });

/** Select one base plugin graph during config evaluation, before registration. */
export const defineConfig = createDefineConfig((renderer, consumerPlugins) =>
  composeUltramodernAppTools({ renderer, consumerPlugins }),
);
