import path from 'node:path';
import type { AppTools, CliPlugin } from '../types';
import {
  emitFrameworkMicroVerticalReleaseEnvelope,
  emitNodeStagedReleaseEnvelope,
  verifyBuildOutputReleaseEnvelope,
  verifyNodeReleaseEnvelopeStaging,
} from '../ultramodern-release-envelope/framework-output';
import { resolveDeployTarget } from './deploy';

const resolveActiveDeployTarget = (
  api: Parameters<NonNullable<CliPlugin<AppTools>['setup']>>[0],
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

export default (): CliPlugin<AppTools> => ({
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
      const configuredTarget = resolveActiveDeployTarget(api);
      if (configuredTarget !== 'node') {
        return;
      }
      await emitBuildEnvelope(configuredTarget);
      const { distDirectory } = api.getAppContext();
      await verifyBuildOutputReleaseEnvelope(distDirectory, configuredTarget);
    });

    api.onAfterDeploy(async () => {
      const configuredTarget = resolveActiveDeployTarget(api);
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
});
