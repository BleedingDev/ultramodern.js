import { verticalApiGroupName } from './api';
import { createBackendFederationMetadata } from './backend-federation';
import { createDeliveryUnitRecord } from './delivery-unit';
import { remoteComponentOutputPath } from './demo-components';
import {
  appHasApi,
  appI18nNamespace,
  remoteDependencyAlias,
  shellApp,
} from './descriptors';
import { packageName, tailwindPrefixForApp } from './naming';
import { createCloudflareSecurityContract } from './policy';
import { publicSurfaceManagedSourceAssetPaths } from './public-surface';
import {
  createLocalisedUrlsMap,
  createRouteMetaFilePath,
  createRouteOwnedI18nPaths,
  createRoutePageFilePath,
} from './routes';
import type { WorkspaceApp } from './types';
import {
  CLOUDFLARE_COMPATIBILITY_DATE,
  EFFECT_VERSION,
  MODULE_FEDERATION_VERSION,
  NODE_VERSION,
  PNPM_VERSION,
} from './versions';
import {
  createWorkspaceRootPackageScripts,
  createWorkspaceRootScriptPlan,
} from './workspace-script-plan';

type WorkspaceValidationContract = ReturnType<
  typeof createWorkspaceValidationContract
>;

export function createWorkspaceValidationContract(
  scope: string,
  enableTailwind: boolean,
  remotes: WorkspaceApp[] = [],
) {
  const fullStackVerticals = remotes.filter(appHasApi).map(remote => ({
    id: remote.id,
    domain: remote.domain,
    stem: remote.api.stem,
    group: verticalApiGroupName(remote),
    path: remote.directory,
    port: remote.port,
    mfName: remote.mfName,
    apiPrefix: remote.api.prefix,
    tailwindPrefix: tailwindPrefixForApp(remote),
    zephyrAlias: remoteDependencyAlias(remote),
    packageName: packageName(scope, remote.packageSuffix),
    backendFederation: createBackendFederationMetadata(scope, remote),
    deliveryUnit: createDeliveryUnitRecord(scope, remote),
    exposes: Object.keys(remote.exposes ?? {}),
    componentPaths: Object.keys(remote.exposes ?? {})
      .map(expose => remoteComponentOutputPath(remote, expose))
      .filter((componentPath): componentPath is string =>
        Boolean(componentPath),
      ),
    namespace: appI18nNamespace(remote),
    routePagePaths: createRouteOwnedI18nPaths(remote)
      .filter(route => route.canonicalPath !== '/')
      .map(route => createRoutePageFilePath(remote, route.canonicalPath)),
    routeMetaPaths: createRouteOwnedI18nPaths(remote).map(route =>
      createRouteMetaFilePath(remote, route.canonicalPath),
    ),
    localisedUrls: createLocalisedUrlsMap(remote),
    verticalRefs: remote.verticalRefs ?? [],
  }));

  return {
    packageScope: scope,
    versions: {
      cloudflareCompatibilityDate: CLOUDFLARE_COMPATIBILITY_DATE,
      effect: EFFECT_VERSION,
      moduleFederation: MODULE_FEDERATION_VERSION,
      node: NODE_VERSION,
      pnpm: PNPM_VERSION,
    },
    tailwindEnabled: enableTailwind,
    fullStackVerticals,
    shellNamespace: appI18nNamespace(shellApp),
    oldRemotePaths: ['apps/remotes'],
    scripts: createWorkspaceRootScriptPlan(remotes),
    packageScripts: createWorkspaceRootPackageScripts(remotes),
    cloudflareSecurity: createCloudflareSecurityContract(),
    publicSurfaceManagedSourceAssetPaths: [
      ...publicSurfaceManagedSourceAssetPaths,
    ],
    shellRouteMetaPaths: createRouteOwnedI18nPaths(shellApp).map(route =>
      createRouteMetaFilePath(shellApp, route.canonicalPath),
    ),
  };
}
