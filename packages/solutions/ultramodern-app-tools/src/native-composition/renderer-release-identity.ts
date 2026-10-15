import type { RendererBuildIdentities } from '@modern-js/app-tools-extensions/renderer-build-identity';
import {
  type RsbuildPlugin,
  type RsbuildPluginAPI,
  rspack,
} from '@rsbuild/core';
import {
  isUltramodernReleaseIdentityBannerPlugin,
  releaseIdentityBanner,
} from './preset';

/**
 * A UI delivery unit's build marker is its renderer buildId: the value stamped
 * into renderer-build.json, ultramodern-build.json and the release envelope.
 * Replace the preset's release identity in every bundle with that one value,
 * so the chunk banner and `ULTRAMODERN_BUILD_MARKER` agree with the manifests.
 */
export function applyRendererReleaseIdentity(
  api: RsbuildPluginAPI,
  getIdentities: () => RendererBuildIdentities | undefined,
): void {
  api.modifyBundlerChain({
    order: 'post',
    handler: chain => {
      const identities = getIdentities();
      if (!identities) return;
      if (chain.plugins.has('globalVars'))
        chain.plugin('globalVars').tap(args => {
          const definitions = { ...args[0] };
          delete definitions.ULTRAMODERN_BUILD_MARKER;
          delete definitions.ULTRAMODERN_SOURCE_REVISION;
          return [definitions, ...args.slice(1)];
        });
      chain
        .plugin('ultramodern-renderer-runtime-identity')
        .use(rspack.DefinePlugin, [
          {
            ULTRAMODERN_BUILD_MARKER: JSON.stringify(identities.buildId),
            ULTRAMODERN_SOURCE_REVISION: JSON.stringify(
              identities.sourceRevision,
            ),
          },
        ]);
    },
  });
  api.modifyRspackConfig({
    order: 'post',
    handler: config => {
      const identities = getIdentities();
      if (!identities) return config;
      const { buildId, sourceRevision } = identities;
      config.plugins = (config.plugins ?? []).filter(
        plugin => !isUltramodernReleaseIdentityBannerPlugin(plugin),
      );
      // After minimization and before asset hashing, so a changed
      // identity changes every emitted script's content hash.
      config.plugins.push(
        new rspack.BannerPlugin({
          banner: releaseIdentityBanner([buildId, sourceRevision]),
          raw: true,
          stage: rspack.Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE,
          test: /\.(?:c|m)?js$/u,
        }),
      );
      return config;
    },
  });
}

/** Native renderer owners bind their resolved identities through this plugin. */
export const rendererReleaseIdentityBuilderPlugin = (
  getIdentities: () => RendererBuildIdentities | undefined,
): RsbuildPlugin => ({
  name: 'ultramodern:renderer-release-identity',
  setup(api) {
    applyRendererReleaseIdentity(api, getIdentities);
  },
});
