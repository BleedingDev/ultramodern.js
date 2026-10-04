import path from 'node:path';
import type { RendererProfile } from '@modern-js/backend-federation-contracts';
import {
  emitFrameworkMicroVerticalReleaseEnvelope,
  emitNodeStagedReleaseEnvelope,
  verifyBuildOutputReleaseEnvelope,
  verifyNodeReleaseEnvelopeStaging,
} from './framework-output';

type ReleaseEnvelopeTarget = 'cloudflare' | 'node' | string;

export interface ReleaseEnvelopeConfig {
  deploy?: { target?: string };
}

export interface ReleaseEnvelopeAppContext {
  apiOnly: boolean;
  appDirectory: string;
  distDirectory: string;
  metaName: string;
}

export interface ReleaseEnvelopePluginApi<
  Config extends ReleaseEnvelopeConfig = ReleaseEnvelopeConfig,
> {
  getAppContext(): ReleaseEnvelopeAppContext;
  getNormalizedConfig(): Config;
  onAfterBuild(handler: () => Promise<void>): void;
  onBeforeDeploy(handler: () => Promise<void>): void;
  onAfterDeploy(handler: () => Promise<void>): void;
}

export interface ReleaseEnvelopePlugin<
  Config extends ReleaseEnvelopeConfig = ReleaseEnvelopeConfig,
> {
  name: string;
  pre: string[];
  post: string[];
  setup(api: ReleaseEnvelopePluginApi<Config>): void;
}

export type ResolveDeployTarget<
  Config extends ReleaseEnvelopeConfig = ReleaseEnvelopeConfig,
> = (config: Config) => ReleaseEnvelopeTarget;

const resolveActiveDeployTarget = <Config extends ReleaseEnvelopeConfig>(
  api: ReleaseEnvelopePluginApi<Config>,
  resolveDeployTarget: ResolveDeployTarget<Config>,
) => {
  const { metaName } = api.getAppContext();
  const config = api.getNormalizedConfig();
  if (
    metaName !== 'modern-js' &&
    !config.deploy?.target &&
    !process.env.MODERNJS_DEPLOY
  ) {
    return undefined;
  }
  return resolveDeployTarget(config);
};

export const createUltramodernReleaseEnvelopePlugin = <
  Config extends ReleaseEnvelopeConfig,
>({
  resolveDeployTarget,
  resolveRendererProfile,
}: {
  resolveDeployTarget: ResolveDeployTarget<Config>;
  resolveRendererProfile?: (config: Config) => RendererProfile;
}): ReleaseEnvelopePlugin<Config> => {
  return {
    name: '@modern-js/ultramodern-release-envelope',
    pre: [
      '@modern-js/backend-federation-build',
      '@modern-js/plugin-bff',
      '@modern-js/deploy-output-aliases',
    ],
    post: ['@modern-js/plugin-deploy'],
    setup(api) {
      const emitBuildEnvelope = async (
        target: 'node' | 'cloudflare',
        requirePromotable = true,
      ) => {
        const { apiOnly, appDirectory, distDirectory } = api.getAppContext();
        await emitFrameworkMicroVerticalReleaseEnvelope({
          apiOnly,
          appDirectory,
          distDirectory,
          requirePromotable,
          target,
          ...(!apiOnly && resolveRendererProfile
            ? {
                expectedRendererProfile: resolveRendererProfile(
                  api.getNormalizedConfig(),
                ),
              }
            : {}),
        });
      };

      api.onAfterBuild(async () => {
        const configuredTarget = resolveDeployTarget(api.getNormalizedConfig());
        if (configuredTarget !== 'node' && configuredTarget !== 'cloudflare') {
          return;
        }
        // A plain `modern build` is the development path: a dirty or non-Git
        // checkout resolves to the `workspace` source revision, which is not
        // promotable but must still build. Deploy re-emits the envelope and
        // verifies it, so the release gate keeps its teeth there.
        await emitBuildEnvelope(configuredTarget, false);
      });

      api.onBeforeDeploy(async () => {
        const configuredTarget = resolveActiveDeployTarget(
          api,
          resolveDeployTarget,
        );
        if (configuredTarget !== 'node') {
          return;
        }
        await emitBuildEnvelope(configuredTarget);
        const { distDirectory } = api.getAppContext();
        await verifyBuildOutputReleaseEnvelope(distDirectory, configuredTarget);
      });

      api.onAfterDeploy(async () => {
        const configuredTarget = resolveActiveDeployTarget(
          api,
          resolveDeployTarget,
        );
        if (configuredTarget !== 'node') {
          return;
        }
        const { appDirectory, distDirectory } = api.getAppContext();
        const outputDirectory = path.join(appDirectory, '.output');
        const releaseEnvelope = await emitNodeStagedReleaseEnvelope({
          distDirectory,
          outputDirectory,
        });
        if (releaseEnvelope) {
          await verifyNodeReleaseEnvelopeStaging({
            outputDirectory,
          });
        }
      });
    },
  };
};
