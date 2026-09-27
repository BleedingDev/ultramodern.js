import { createCloudflarePreset } from '@modern-js/app-tools-extensions/cloudflare';
import { getDeployingTarget } from '@modern-js/app-tools-extensions/deploy-output/target';
import type {
  AppTools,
  AppToolsNormalizedConfig,
  CliPlugin,
} from '../../types';
import type { DeployTarget } from '../../types/config/deploy';
import type { AppToolsContext } from '../../types/plugin';
import { createGhPagesPreset } from './platforms/gh-pages';
import { createNetlifyPreset } from './platforms/netlify';
import { createNodePreset } from './platforms/node';
import type { CreatePreset } from './platforms/platform';
import { createVercelPreset } from './platforms/vercel';
import type { PluginAPI } from './types';
import { getProjectUsage } from './utils';

const deployPresets = {
  node: createNodePreset,
  vercel: createVercelPreset,
  netlify: createNetlifyPreset,
  ghPages: createGhPagesPreset,
  cloudflare: createCloudflarePreset,
} satisfies Record<DeployTarget, CreatePreset>;

async function getDeployPreset(
  appContext: AppToolsContext,
  modernConfig: AppToolsNormalizedConfig,
  deployTarget: DeployTarget,
  api: PluginAPI,
) {
  const { appDirectory, distDirectory, metaName } = appContext;
  const { useSSR, useAPI, useWebServer } = getProjectUsage(
    appDirectory,
    distDirectory,
    metaName,
  );
  const needModernServer = useSSR || useAPI || useWebServer;

  return deployPresets[deployTarget]({
    appContext,
    modernConfig,
    needModernServer,
    api,
  });
}

export default (): CliPlugin<AppTools> => ({
  name: '@modern-js/plugin-deploy',
  setup: api => {
    api.deploy(async () => {
      const appContext = api.getAppContext();
      const deployTarget = getDeployingTarget(appContext);
      if (!deployTarget) {
        return;
      }
      const deployPreset = await getDeployPreset(
        appContext,
        api.getNormalizedConfig(),
        deployTarget,
        api,
      );

      deployPreset?.prepare && (await deployPreset?.prepare());
      deployPreset?.writeOutput && (await deployPreset?.writeOutput());
      deployPreset?.genEntry && (await deployPreset?.genEntry());
      deployPreset?.end && (await deployPreset?.end());
    });
  },
});
