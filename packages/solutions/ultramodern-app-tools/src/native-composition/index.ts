import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  type RendererBuildProfile,
  resolveCandidateRendererProfile,
  resolveRendererProfile,
} from './renderer-profile';
export type { AppUserConfig, UltramodernAppUserConfig } from './types';
export {
  createPresetUltramodernWorkspaceConfig,
  type PresetUltramodernWorkspaceOptions,
  presetUltramodernWorkspace,
} from './workspace-preset';
export type { PolicyDefaultsOptions };

function composeNativeRenderer(
  renderer: Exclude<Renderer, 'react'>,
  consumerPlugins: readonly CliPlugin<AppTools>[],
): CliPlugin<AppTools> {
  let rendererIdentities: Readonly<Record<string, RendererIdentity>> = {};
  const resolveBuildIdentities = createRendererBuildIdentityResolver(renderer);
  let generator: Promise<NativeEntryGenerator> | undefined;
  const resolveGenerator = () =>
    (generator ??= import('./native-entry').then(module =>
      module.createNativeEntryGenerator(renderer),
    ));
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
        rendererBuildPlugin: `@modern-js/renderer-${renderer}-infrastructure`,
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
        const compiler =
          renderer === 'solid'
            ? (await import('../renderers/solid/compiler')).pluginSolidRenderer(
                { rendererIdentities: () => rendererIdentities },
              )
            : (
                await import('../renderers/octane/compiler')
              ).createOctaneCompilerPlugin({
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
  } = {},
): CliPlugin<AppTools> => {
  if (options.renderer && options.renderer !== 'react') {
    return composeNativeRenderer(
      options.renderer,
      options.consumerPlugins ?? [],
    );
  }
  let directory = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const manifestFile = path.join(directory, 'package.json');
    if (existsSync(manifestFile)) {
      const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
      if (
        typeof manifest.name !== 'string' ||
        !manifest.exports?.['./react-composition']
      )
        throw new Error(
          'The owning UltraModern package must export its selected React composition',
        );
      const { composeReactRenderer } = createRequire(import.meta.url)(
        `${manifest.name}/react-composition`,
      ) as typeof import('./react-composition');
      return composeReactRenderer({ consumerPlugins: options.consumerPlugins });
    }
    const parent = path.dirname(directory);
    if (parent === directory)
      throw new Error(
        'Cannot find the owning UltraModern package for React composition',
      );
    directory = parent;
  }
};

/** The explicit legacy base is React; renderer selection belongs to config. */
export const ultramodernAppTools = (): CliPlugin<AppTools> =>
  composeUltramodernAppTools({ renderer: 'react' });

/** Select one base plugin graph during config evaluation, before registration. */
export const defineConfig = createDefineConfig((renderer, consumerPlugins) =>
  composeUltramodernAppTools({ renderer, consumerPlugins }),
);
