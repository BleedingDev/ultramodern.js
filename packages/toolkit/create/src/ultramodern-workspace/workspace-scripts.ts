import { remoteComponentOutputPath } from './demo-components';
import {
  appHasEffectApi,
  appI18nNamespace,
  remoteDependencyAlias,
  shellApp,
} from './descriptors';
import { verticalEffectGroupName } from './effect-api';
import {
  readFileTemplate,
  renderFileTemplate,
  writeFileReplacing,
} from './fs-io';
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
  NODE_VERSION,
  PNPM_VERSION,
} from './versions';

export function createAssertMfTypesScript(
  remotes: WorkspaceApp[] = [],
): string {
  return renderFileTemplate('workspace-scripts/assert-mf-types.mjs', {
    defaultAppDirsJson: JSON.stringify(
      remotes.map(remote => remote.directory),
      null,
      2,
    ),
  });
}

export function createWorkspaceValidationScript(
  scope: string,
  enableTailwind: boolean,
  remotes: WorkspaceApp[] = [],
): string {
  const verticals = remotes.filter(appHasEffectApi).map(remote => ({
    id: remote.id,
    domain: remote.domain,
    stem: remote.effectApi.stem,
    group: verticalEffectGroupName(remote),
    path: remote.directory,
    mfName: remote.mfName,
    apiPrefix: remote.effectApi.prefix,
    tailwindPrefix: tailwindPrefixForApp(remote),
    zephyrAlias: remoteDependencyAlias(remote),
    packageName: packageName(scope, remote.packageSuffix),
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
  const shellRouteMetaPaths = createRouteOwnedI18nPaths(shellApp).map(route =>
    createRouteMetaFilePath(shellApp, route.canonicalPath),
  );
  const shellNamespace = appI18nNamespace(shellApp);
  const oldRemotePaths = ['apps/remotes'];
  const expectedBuildScript =
    remotes.length > 0
      ? 'ULTRAMODERN_ZEPHYR=false pnpm -r --filter "./verticals/*" run build && ULTRAMODERN_ZEPHYR=false pnpm --filter "./apps/shell-super-app" run build && pnpm mf:types && pnpm performance:readiness'
      : 'ULTRAMODERN_ZEPHYR=false pnpm --filter "./apps/shell-super-app" run build && pnpm mf:types && pnpm performance:readiness';
  const expectedCloudflareBuildScript =
    remotes.length > 0
      ? 'pnpm -r --filter "./verticals/*" run cloudflare:build && pnpm --filter "./apps/shell-super-app" run cloudflare:build && pnpm mf:types'
      : 'pnpm --filter "./apps/shell-super-app" run cloudflare:build && pnpm mf:types';
  const expectedCloudflareDeployScript =
    remotes.length > 0
      ? 'pnpm -r --filter "./verticals/*" run cloudflare:deploy && pnpm --filter "./apps/shell-super-app" run cloudflare:deploy'
      : 'pnpm --filter "./apps/shell-super-app" run cloudflare:deploy';
  const expectedCloudflareSecurity = createCloudflareSecurityContract();

  return renderFileTemplate(
    'workspace-scripts/validate-ultramodern-workspace.mjs',
    {
      packageScope: scope,
      nodeVersion: NODE_VERSION,
      pnpmVersion: PNPM_VERSION,
      tailwindEnabledJson: JSON.stringify(enableTailwind),
      fullStackVerticalsJson: JSON.stringify(verticals, null, 2),
      shellNamespaceJson: JSON.stringify(shellNamespace),
      oldRemotePathsJson: JSON.stringify(oldRemotePaths, null, 2),
      expectedBuildScriptJson: JSON.stringify(expectedBuildScript),
      expectedCloudflareBuildScriptJson: JSON.stringify(
        expectedCloudflareBuildScript,
      ),
      expectedCloudflareDeployScriptJson: JSON.stringify(
        expectedCloudflareDeployScript,
      ),
      expectedCloudflareSecurityJson: JSON.stringify(
        expectedCloudflareSecurity,
        null,
        2,
      ),
      publicSurfaceManagedSourceAssetPathsJson: JSON.stringify(
        [...publicSurfaceManagedSourceAssetPaths],
        null,
        2,
      ),
      shellRouteMetaPathsJson: JSON.stringify(shellRouteMetaPaths, null, 2),
      cloudflareCompatibilityDate: CLOUDFLARE_COMPATIBILITY_DATE,
    },
  );
}

export function createWorkspaceI18nBoundaryValidationScript(): string {
  return readFileTemplate(
    'workspace-scripts/check-ultramodern-i18n-boundaries.mjs',
  );
}

export function createPublicSurfaceAssetsScript(): string {
  return readFileTemplate(
    'workspace-scripts/generate-public-surface-assets.mjs',
  );
}

export function createCloudflareProofHelperScript(): string {
  return readFileTemplate('workspace-scripts/ultramodern-cloudflare-proof.mjs');
}

export function createCloudflareVersionProofScript(): string {
  return readFileTemplate('workspace-scripts/proof-cloudflare-version.mjs');
}

export function createPerformanceReadinessConfigScript(): string {
  return readFileTemplate(
    'workspace-scripts/ultramodern-performance-readiness.config.mjs',
  );
}

export function createPerformanceReadinessScript(): string {
  return readFileTemplate(
    'workspace-scripts/ultramodern-performance-readiness.mjs',
  );
}

export function writeGeneratedWorkspaceScripts(
  targetDir: string,
  scope: string,
  enableTailwind: boolean,
  remotes: WorkspaceApp[] = [],
) {
  writeFileReplacing(
    targetDir,
    'scripts/assert-mf-types.mjs',
    createAssertMfTypesScript(remotes),
  );
  writeFileReplacing(
    targetDir,
    'scripts/validate-ultramodern-workspace.mjs',
    createWorkspaceValidationScript(scope, enableTailwind, remotes),
  );
  writeFileReplacing(
    targetDir,
    'scripts/check-ultramodern-i18n-boundaries.mjs',
    createWorkspaceI18nBoundaryValidationScript(),
  );
  writeFileReplacing(
    targetDir,
    'scripts/generate-public-surface-assets.mjs',
    createPublicSurfaceAssetsScript(),
  );
  writeFileReplacing(
    targetDir,
    'scripts/ultramodern-cloudflare-proof.mjs',
    createCloudflareProofHelperScript(),
  );
  writeFileReplacing(
    targetDir,
    'scripts/proof-cloudflare-version.mjs',
    createCloudflareVersionProofScript(),
  );
  writeFileReplacing(
    targetDir,
    'scripts/ultramodern-performance-readiness.config.mjs',
    createPerformanceReadinessConfigScript(),
  );
  writeFileReplacing(
    targetDir,
    'scripts/ultramodern-performance-readiness.mjs',
    createPerformanceReadinessScript(),
  );
}
