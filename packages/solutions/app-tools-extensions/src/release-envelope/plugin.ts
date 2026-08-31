import path from 'node:path';
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
}: {
  resolveDeployTarget: ResolveDeployTarget<Config>;
}): ReleaseEnvelopePlugin<Config> => {
  return {
    name: '@modern-js/ultramodern-release-envelope',
    pre: ['@modern-js/backend-federation-build', '@modern-js/plugin-bff'],
    post: ['@modern-js/plugin-deploy'],
    setup(api) {
      const emitBuildEnvelope = async (target: 'node' | 'cloudflare') => {
        const { apiOnly, distDirectory } = api.getAppContext();
        await emitFrameworkMicroVerticalReleaseEnvelope({
          apiOnly,
          distDirectory,
          target,
        });
      };

      api.onAfterBuild(async () => {
        const configuredTarget = resolveDeployTarget(api.getNormalizedConfig());
        if (configuredTarget !== 'node' && configuredTarget !== 'cloudflare') {
          return;
        }
        await emitBuildEnvelope(configuredTarget);
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
