import fs from 'node:fs';
import path from 'node:path';
import { verticalApiGroupName } from './api';
import { remoteComponentOutputPath } from './demo-components';
import {
  appHasApi,
  appI18nNamespace,
  remoteDependencyAlias,
  shellApp,
} from './descriptors';
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
  EFFECT_VERSION,
  MODULE_FEDERATION_VERSION,
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

function removeLegacyWorkspaceScript(targetDir: string, relativePath: string) {
  fs.rmSync(path.join(targetDir, relativePath), { force: true });
}

function writeWorkspaceOwnedMtsScript(
  targetDir: string,
  name: string,
  content: string,
) {
  writeFileReplacing(targetDir, `scripts/${name}.mts`, content);
  removeLegacyWorkspaceScript(targetDir, `scripts/${name}.mjs`);
}

function migrateCopiedWorkspaceScriptToMts(targetDir: string, name: string) {
  const legacyPath = path.join(targetDir, `scripts/${name}.mjs`);
  const migratedPath = path.join(targetDir, `scripts/${name}.mts`);

  if (!fs.existsSync(legacyPath)) {
    return;
  }

  if (fs.existsSync(migratedPath)) {
    fs.rmSync(legacyPath, { force: true });
    return;
  }

  fs.renameSync(legacyPath, migratedPath);
}

export function createWorkspaceValidationScript(
  scope: string,
  enableTailwind: boolean,
  remotes: WorkspaceApp[] = [],
): string {
  const verticals = remotes.filter(appHasApi).map(remote => ({
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
      effectVersion: EFFECT_VERSION,
      moduleFederationVersion: MODULE_FEDERATION_VERSION,
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
    'workspace-scripts/check-ultramodern-i18n-boundaries.mts',
  );
}

export function createWorkspaceApiBoundaryValidationScript(): string {
  return readFileTemplate(
    'workspace-scripts/check-ultramodern-api-boundaries.mts',
  );
}

export function createPerformanceReadinessConfigScript(): string {
  return readFileTemplate(
    'workspace-scripts/ultramodern-performance-readiness.config.mjs',
  );
}

export function createNodeBackendFederationProofScript(): string {
  return readFileTemplate(
    'workspace-scripts/proof-node-backend-federation.mjs',
  );
}

export function writeGeneratedWorkspaceScripts(
  targetDir: string,
  _scope: string,
  _enableTailwind: boolean,
  _remotes: WorkspaceApp[] = [],
) {
  writeWorkspaceOwnedMtsScript(
    targetDir,
    'assert-mf-types',
    createToolWrapperScript('mf-types'),
  );
  writeWorkspaceOwnedMtsScript(
    targetDir,
    'validate-ultramodern-workspace',
    createToolWrapperScript('validate'),
  );
  writeWorkspaceOwnedMtsScript(
    targetDir,
    'check-ultramodern-i18n-boundaries',
    createWorkspaceI18nBoundaryValidationScript(),
  );
  writeWorkspaceOwnedMtsScript(
    targetDir,
    'check-ultramodern-api-boundaries',
    createWorkspaceApiBoundaryValidationScript(),
  );
  writeWorkspaceOwnedMtsScript(
    targetDir,
    'generate-public-surface-assets',
    createToolWrapperScript('public-surface'),
  );
  writeWorkspaceOwnedMtsScript(
    targetDir,
    'proof-cloudflare-version',
    createToolWrapperScript('cloudflare-proof'),
  );
  writeFileReplacing(
    targetDir,
    'scripts/proof-node-backend-federation.mjs',
    createNodeBackendFederationProofScript(),
  );
  writeFileReplacing(
    targetDir,
    'scripts/ultramodern-performance-readiness.config.mjs',
    createPerformanceReadinessConfigScript(),
  );
  writeWorkspaceOwnedMtsScript(
    targetDir,
    'ultramodern-performance-readiness',
    createToolWrapperScript('performance-readiness'),
  );
  writeWorkspaceOwnedMtsScript(
    targetDir,
    'migrate-strict-effect',
    createToolWrapperScript('migrate-strict-effect'),
  );
  writeWorkspaceOwnedMtsScript(
    targetDir,
    'ultramodern-typecheck',
    createToolWrapperScript('typecheck'),
  );
  writeWorkspaceOwnedMtsScript(
    targetDir,
    'bootstrap-agent-skills',
    createSkillsToolWrapperScript(),
  );
  migrateCopiedWorkspaceScriptToMts(targetDir, 'setup-agent-reference-repos');
}
