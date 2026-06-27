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

function createToolWrapperScript(command: string, extraArgs: string[] = []) {
  const commandJson = JSON.stringify(command);
  const extraArgsJson = JSON.stringify(extraArgs);

  return `#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const createBin = process.env.ULTRAMODERN_CREATE_BIN;
const forwardedArgs = process.argv.slice(2);
const workspaceRoot =
  process.env.ULTRAMODERN_WORKSPACE_ROOT ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ultramodernArgs = ['ultramodern', ${commandJson}, ...${extraArgsJson}, ...forwardedArgs];
const result = createBin
  ? spawnSync(process.execPath, [createBin, ...ultramodernArgs], {
      env: { ...process.env, ULTRAMODERN_WORKSPACE_ROOT: workspaceRoot },
      stdio: 'inherit',
    })
  : spawnSync('modern-js-create', ultramodernArgs, {
      env: { ...process.env, ULTRAMODERN_WORKSPACE_ROOT: workspaceRoot },
      shell: process.platform === 'win32',
      stdio: 'inherit',
    });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
`;
}

function createSkillsToolWrapperScript() {
  return `#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const createBin = process.env.ULTRAMODERN_CREATE_BIN;
const forwardedArgs = process.argv.slice(2);
const workspaceRoot =
  process.env.ULTRAMODERN_WORKSPACE_ROOT ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = forwardedArgs.includes('--check');
const skillArgs = checkOnly
  ? ['skills', 'check', ...forwardedArgs.filter(arg => arg !== '--check')]
  : ['skills', 'install', ...forwardedArgs];
const ultramodernArgs = ['ultramodern', ...skillArgs];
const result = createBin
  ? spawnSync(process.execPath, [createBin, ...ultramodernArgs], {
      env: { ...process.env, ULTRAMODERN_WORKSPACE_ROOT: workspaceRoot },
      stdio: 'inherit',
    })
  : spawnSync('modern-js-create', ultramodernArgs, {
      env: { ...process.env, ULTRAMODERN_WORKSPACE_ROOT: workspaceRoot },
      shell: process.platform === 'win32',
      stdio: 'inherit',
    });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
`;
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
    port: remote.port,
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

export function createPerformanceReadinessConfigScript(): string {
  return readFileTemplate(
    'workspace-scripts/ultramodern-performance-readiness.config.mjs',
  );
}

export function writeGeneratedWorkspaceScripts(
  targetDir: string,
  _scope: string,
  _enableTailwind: boolean,
  _remotes: WorkspaceApp[] = [],
) {
  writeFileReplacing(
    targetDir,
    'scripts/assert-mf-types.mjs',
    createToolWrapperScript('mf-types'),
  );
  writeFileReplacing(
    targetDir,
    'scripts/validate-ultramodern-workspace.mjs',
    createToolWrapperScript('validate'),
  );
  writeFileReplacing(
    targetDir,
    'scripts/check-ultramodern-i18n-boundaries.mjs',
    createWorkspaceI18nBoundaryValidationScript(),
  );
  writeFileReplacing(
    targetDir,
    'scripts/generate-public-surface-assets.mjs',
    createToolWrapperScript('public-surface'),
  );
  writeFileReplacing(
    targetDir,
    'scripts/proof-cloudflare-version.mjs',
    createToolWrapperScript('cloudflare-proof'),
  );
  writeFileReplacing(
    targetDir,
    'scripts/ultramodern-performance-readiness.config.mjs',
    createPerformanceReadinessConfigScript(),
  );
  writeFileReplacing(
    targetDir,
    'scripts/ultramodern-performance-readiness.mjs',
    createToolWrapperScript('performance-readiness'),
  );
  writeFileReplacing(
    targetDir,
    'scripts/ultramodern-typecheck.mjs',
    createToolWrapperScript('typecheck'),
  );
  writeFileReplacing(
    targetDir,
    'scripts/bootstrap-agent-skills.mjs',
    createSkillsToolWrapperScript(),
  );
}
