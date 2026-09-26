import { createRequire } from 'node:module';
import path from 'node:path';
import type { NodePublicAssetConfig } from '../config';
import { preserveNpmAliases, readPackageIdentity } from './npmAliases';
import {
  NODE_PUBLIC_ASSET_SCOPE,
  normalizeDeclaredPublicAssets,
  stageDeclaredPublicAssets,
} from './public-assets';
import {
  type DeployOutputConfig,
  resolveDeployTarget as defaultResolveDeployTarget,
} from './target';

export interface DeployOutputPluginApi {
  getAppContext(): { appDirectory: string; metaName: string };
  getNormalizedConfig(): DeployOutputConfig;
  onAfterDeploy(handler: () => Promise<void>): void;
}

export const createDeployOutputAliasesPlugin = ({
  resolveDeployTarget = defaultResolveDeployTarget,
}: {
  resolveDeployTarget?: (config: DeployOutputConfig) => string;
} = {}) => ({
  name: '@modern-js/deploy-output-aliases',
  setup(api: DeployOutputPluginApi) {
    api.onAfterDeploy(async () => {
      const { appDirectory, metaName } = api.getAppContext();
      const config = api.getNormalizedConfig();
      if (
        (metaName !== 'modern-js' &&
          !config.deploy?.target &&
          !process.env.MODERNJS_DEPLOY) ||
        resolveDeployTarget(config) !== 'node'
      ) {
        return;
      }

      const entry = createRequire(__filename).resolve('@modern-js/prod-server');
      const identity = await readPackageIdentity(entry);
      await preserveNpmAliases({
        appDirectory,
        outputDirectory: path.join(appDirectory, '.output'),
        implicitAliases: [
          {
            aliasName: '@modern-js/prod-server',
            targetName: identity.name,
            targetVersion: identity.version,
          },
        ],
      });
    });
  },
});

export interface DeployOutputPublicAssetsConfig extends DeployOutputConfig {
  deploy?: DeployOutputConfig['deploy'] & {
    node?: { publicAssets?: NodePublicAssetConfig[] };
  };
}

export interface DeployOutputPublicAssetsPluginApi {
  getAppContext(): { appDirectory: string; metaName: string };
  getNormalizedConfig(): DeployOutputPublicAssetsConfig;
  onAfterDeploy(handler: () => Promise<void>): void;
}

/**
 * Stage `deploy.node.publicAssets` into the Node deploy output. Cloudflare
 * stages `deploy.worker.publicAssets` inside its deploy preset.
 */
export const createDeployOutputPublicAssetsPlugin = ({
  resolveDeployTarget = defaultResolveDeployTarget,
}: {
  resolveDeployTarget?: (config: DeployOutputConfig) => string;
} = {}) => ({
  name: '@modern-js/deploy-output-public-assets',
  setup(api: DeployOutputPublicAssetsPluginApi) {
    api.onAfterDeploy(async () => {
      const { appDirectory, metaName } = api.getAppContext();
      const config = api.getNormalizedConfig();
      if (
        (metaName !== 'modern-js' &&
          !config.deploy?.target &&
          !process.env.MODERNJS_DEPLOY) ||
        resolveDeployTarget(config) !== 'node'
      ) {
        return;
      }

      await stageDeclaredPublicAssets({
        appDirectory,
        outputDirectory: path.join(appDirectory, '.output'),
        assets: normalizeDeclaredPublicAssets(
          config.deploy?.node?.publicAssets,
          NODE_PUBLIC_ASSET_SCOPE,
        ),
        scope: NODE_PUBLIC_ASSET_SCOPE,
      });
    });
  },
});
