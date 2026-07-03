import fs from 'node:fs';
import path from 'node:path';
import {
  readFileTemplate,
  renderFileTemplate,
  writeFileReplacing,
} from './fs-io';
import {
  GENERATED_TOOLING_COMMANDS,
  type GeneratedToolingCommandKey,
  generatedToolingCommands,
} from './tooling-command-catalog';
import type { WorkspaceApp } from './types';
import { createWorkspaceValidationContract } from './workspace-validation-contract';

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

function writeGeneratedToolWrapperScript(
  targetDir: string,
  key: GeneratedToolingCommandKey,
) {
  const command = GENERATED_TOOLING_COMMANDS[key];
  writeWorkspaceOwnedMtsScript(
    targetDir,
    command.wrapperName,
    createToolWrapperScript(command.command),
  );
}

export function writeGeneratedToolWrapperScripts(targetDir: string) {
  for (const command of generatedToolingCommands) {
    writeGeneratedToolWrapperScript(targetDir, command.id);
  }
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
  const contract = createWorkspaceValidationContract(
    scope,
    enableTailwind,
    remotes,
  );

  return renderFileTemplate(
    'workspace-scripts/validate-ultramodern-workspace.mjs',
    {
      packageScope: contract.packageScope,
      nodeVersion: contract.versions.node,
      tailwindEnabledJson: JSON.stringify(contract.tailwindEnabled),
      fullStackVerticalsJson: JSON.stringify(
        contract.fullStackVerticals,
        null,
        2,
      ),
      shellNamespaceJson: JSON.stringify(contract.shellNamespace),
      oldRemotePathsJson: JSON.stringify(contract.oldRemotePaths),
      expectedBuildScriptJson: JSON.stringify(contract.scripts.build),
      expectedCloudflareBuildScriptJson: JSON.stringify(
        contract.scripts.cloudflareBuild,
      ),
      expectedCloudflareDeployScriptJson: JSON.stringify(
        contract.scripts.cloudflareDeploy,
      ),
      expectedCloudflareSecurityJson: JSON.stringify(
        contract.cloudflareSecurity,
        null,
        2,
      ),
      workspaceValidationContractJson: JSON.stringify(contract, null, 2),
      publicSurfaceManagedSourceAssetPathsJson: JSON.stringify(
        contract.publicSurfaceManagedSourceAssetPaths,
        null,
        2,
      ),
      shellRouteMetaPathsJson: JSON.stringify(
        contract.shellRouteMetaPaths,
        null,
        2,
      ),
      effectVersion: contract.versions.effect,
      moduleFederationVersion: contract.versions.moduleFederation,
      cloudflareCompatibilityDate:
        contract.versions.cloudflareCompatibilityDate,
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

export function createZeropsRuntimeMaterializationScript(): string {
  return readFileTemplate('workspace-scripts/materialize-zerops-runtime.mjs');
}

export function writeGeneratedWorkspaceScripts(
  targetDir: string,
  _scope: string,
  _enableTailwind: boolean,
  _remotes: WorkspaceApp[] = [],
) {
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
  writeFileReplacing(
    targetDir,
    'scripts/materialize-zerops-runtime.mjs',
    createZeropsRuntimeMaterializationScript(),
  );
  writeFileReplacing(
    targetDir,
    'scripts/ultramodern-performance-readiness.config.mjs',
    createPerformanceReadinessConfigScript(),
  );
  writeGeneratedToolWrapperScripts(targetDir);
  writeWorkspaceOwnedMtsScript(
    targetDir,
    'bootstrap-agent-skills',
    createSkillsToolWrapperScript(),
  );
  migrateCopiedWorkspaceScriptToMts(targetDir, 'setup-agent-reference-repos');
}
