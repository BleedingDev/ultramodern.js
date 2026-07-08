import { provider } from 'std-env';
import type {
  AppTools,
  AppToolsNormalizedConfig,
  CliPlugin,
} from '../../types';
import type { DeployTarget } from '../../types/config/deploy';
import type { AppToolsContext } from '../../types/plugin';
import { createCloudflarePreset } from './platforms/cloudflare/index';
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

export const getSupportedDeployTargets = () =>
  Object.keys(deployPresets) as DeployTarget[];

const isDeployTarget = (target: string): target is DeployTarget =>
  Object.prototype.hasOwnProperty.call(deployPresets, target);

const providerDeployTargets: Partial<Record<string, DeployTarget>> = {
  vercel: 'vercel',
  netlify: 'netlify',
  cloudflare: 'cloudflare',
  cloudflare_pages: 'cloudflare',
  cloudflare_workers: 'cloudflare',
};

const normalizeDetectedProvider = (value?: string) =>
  value ? providerDeployTargets[value] : undefined;

export const resolveDeployTarget = (
  modernConfig: AppToolsNormalizedConfig,
  envDeployTarget = process.env.MODERNJS_DEPLOY,
  detectedProvider = provider,
) =>
  modernConfig.deploy?.target ||
  envDeployTarget ||
  normalizeDetectedProvider(detectedProvider) ||
  'node';

async function getDeployPreset(
  appContext: AppToolsContext,
  modernConfig: AppToolsNormalizedConfig,
  deployTarget: string,
  api: PluginAPI,
) {
  const { appDirectory, distDirectory, metaName } = appContext;
  const { useSSR, useAPI, useWebServer } = getProjectUsage(
    appDirectory,
    distDirectory,
    metaName,
  );
  const needModernServer = useSSR || useAPI || useWebServer;

  if (!isDeployTarget(deployTarget)) {
    throw new Error(
      `Unknown deploy target: '${deployTarget}'. deploy.target or MODERNJS_DEPLOY should be one of: ${getSupportedDeployTargets().join(', ')}.`,
    );
  }

  const createPreset = deployPresets[deployTarget];

  return createPreset({ appContext, modernConfig, needModernServer, api });
}

export default (): CliPlugin<AppTools> => ({
  name: '@modern-js/plugin-deploy',
  setup: api => {
    api.deploy(async () => {
      const appContext = api.getAppContext();
      const { metaName } = appContext;
      const modernConfig = api.getNormalizedConfig();
      const deployTarget = resolveDeployTarget(modernConfig);
      if (
        metaName !== 'modern-js' &&
        !modernConfig.deploy?.target &&
        !process.env.MODERNJS_DEPLOY
      ) {
        return;
      }
      const deployPreset = await getDeployPreset(
        appContext,
        modernConfig,
        deployTarget as DeployTarget,
        api,
      );

      deployPreset?.prepare && (await deployPreset?.prepare());
      deployPreset?.writeOutput && (await deployPreset?.writeOutput());
      deployPreset?.genEntry && (await deployPreset?.genEntry());
      deployPreset?.end && (await deployPreset?.end());
    });
  },
});
