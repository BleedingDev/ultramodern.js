import { createRequire } from 'node:module';
import path from 'node:path';
import type { NodePublicAssetConfig } from '../config';
import { preserveNpmAliases, readPackageIdentity } from './npmAliases';
import {
  NODE_PUBLIC_ASSET_SCOPE,
  normalizeDeclaredPublicAssets,
  stageDeclaredPublicAssets,
} from './public-assets';
import { getDeployingTarget, type ResolvedDeployTarget } from './target';

export interface DeployOutputAppContext {
  appDirectory: string;
  metaName: string;
  deployTarget?: ResolvedDeployTarget;
}

export interface DeployOutputPluginApi {
  getAppContext(): DeployOutputAppContext;
  onAfterDeploy(handler: () => Promise<void>): void;
}

export const createDeployOutputAliasesPlugin = () => ({
  name: '@modern-js/deploy-output-aliases',
  setup(api: DeployOutputPluginApi) {
    api.onAfterDeploy(async () => {
      const appContext = api.getAppContext();
      if (getDeployingTarget(appContext) !== 'node') {
        return;
      }
      const { appDirectory } = appContext;

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

export interface DeployOutputPublicAssetsConfig {
  deploy?: { node?: { publicAssets?: NodePublicAssetConfig[] } };
}

export interface DeployOutputPublicAssetsPluginApi {
  getAppContext(): DeployOutputAppContext;
  getNormalizedConfig(): DeployOutputPublicAssetsConfig;
  onAfterDeploy(handler: () => Promise<void>): void;
}

/**
 * Stage `deploy.node.publicAssets` into the Node deploy output. Cloudflare
 * stages `deploy.worker.publicAssets` inside its deploy preset.
 */
export const createDeployOutputPublicAssetsPlugin = () => ({
  name: '@modern-js/deploy-output-public-assets',
  setup(api: DeployOutputPublicAssetsPluginApi) {
    api.onAfterDeploy(async () => {
      const appContext = api.getAppContext();
      if (getDeployingTarget(appContext) !== 'node') {
        return;
      }
      const { appDirectory } = appContext;
      const config = api.getNormalizedConfig();

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
