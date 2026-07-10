import fs from 'node:fs';
import path from 'node:path';
import type { UltramodernReleaseCohort } from '../ultramodern-release-cohort';
import {
  readFileTemplate,
  renderFileTemplate,
  workspaceTemplateDir,
  writeFileReplacing,
} from './fs-io';
import {
  GENERATED_TOOLING_COMMANDS,
  type GeneratedToolingCommandId,
  type GeneratedToolingCommandKey,
  generatedToolingCommands,
} from './tooling-command-catalog';
import type { WorkspaceApp } from './types';
import { createWorkspaceValidationContract } from './workspace-validation-contract';

// Emitted wrapper source must satisfy the generated workspace's oxfmt config,
// which enforces `singleQuote: true`; JSON.stringify would emit double quotes.
const singleQuoted = (value: string) => `'${value.replace(/'/gu, "\\'")}'`;

function createToolWrapperScript(command: string, extraArgs: string[] = []) {
  const commandLiteral = singleQuoted(command);
  const extraArgsLiteral = `[${extraArgs.map(singleQuoted).join(', ')}]`;

  return `#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const createBin = process.env.ULTRAMODERN_CREATE_BIN;
const forwardedArgs = process.argv.slice(2);
const workspaceRoot =
  process.env.ULTRAMODERN_WORKSPACE_ROOT ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ultramodernArgs = ['ultramodern', ${commandLiteral}, ...${extraArgsLiteral}, ...forwardedArgs];
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

function writeGeneratedToolWrapperScripts(
  targetDir: string,
  options: { shellOnly?: boolean } = {},
) {
  for (const command of generatedToolingCommands) {
    if (options.shellOnly && BACKEND_FEDERATION_WRAPPER_IDS.has(command.id)) {
      continue;
    }
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
  releaseCohort?: UltramodernReleaseCohort,
): string {
  const contract = createWorkspaceValidationContract(
    scope,
    enableTailwind,
    remotes,
    releaseCohort,
  );

  return renderFileTemplate(
    'workspace-scripts/validate-ultramodern-workspace.mjs',
    {
      workspaceValidationContractJson: JSON.stringify(contract, null, 2),
    },
  );
}

function createWorkspaceI18nBoundaryValidationScript(): string {
  return readFileTemplate(
    'workspace-scripts/check-ultramodern-i18n-boundaries.mts',
  );
}

function createWorkspaceApiBoundaryValidationScript(): string {
  return readFileTemplate(
    'workspace-scripts/check-ultramodern-api-boundaries.mts',
  );
}

function createPerformanceReadinessConfigScript(): string {
  return readFileTemplate(
    'workspace-scripts/ultramodern-performance-readiness.config.mjs',
  );
}

function createNodeBackendFederationProofScript(): string {
  return readFileTemplate(
    'workspace-scripts/proof-node-backend-federation.mjs',
  );
}

export function createZeropsRuntimeMaterializationScript(): string {
  return readFileTemplate('workspace-scripts/materialize-zerops-runtime.mjs');
}

export function writeGeneratedWorkspaceScripts(
  targetDir: string,
  scope: string,
  enableTailwind: boolean,
  remotes: WorkspaceApp[] = [],
  releaseCohort?: UltramodernReleaseCohort,
) {
  const shellOnly = remotes.length === 0;

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
  if (!shellOnly) {
    writeFileReplacing(
      targetDir,
      'scripts/materialize-zerops-runtime.mjs',
      createZeropsRuntimeMaterializationScript(),
    );
  }
  writeFileReplacing(
    targetDir,
    'scripts/ultramodern-performance-readiness.config.mjs',
    createPerformanceReadinessConfigScript(),
  );
  writeGeneratedToolWrapperScripts(targetDir, { shellOnly });
  writeWorkspaceOwnedMtsScript(
    targetDir,
    'validate-ultramodern-workspace',
    createWorkspaceValidationScript(
      scope,
      enableTailwind,
      remotes,
      releaseCohort,
    ),
  );
  writeWorkspaceOwnedMtsScript(
    targetDir,
    'bootstrap-agent-skills',
    createSkillsToolWrapperScript(),
  );
  migrateCopiedWorkspaceScriptToMts(targetDir, 'setup-agent-reference-repos');
}

// The canonical `setup-agent-reference-repos` script is vendored under
// template-workspace/ and copied (then renamed to .mts) during fresh scaffolds.
// Migrate has no copy step, so it materializes the same canonical source here.
function createAgentReferenceReposSetupScript(): string {
  return fs.readFileSync(
    path.join(workspaceTemplateDir, 'scripts/setup-agent-reference-repos.mjs'),
    'utf-8',
  );
}

// Tool wrappers that only make sense when the workspace exposes API-bearing
// verticals. Shell-only workspaces skip backend-federation materialization, so
// their migrate must not inject these wrappers (kept consistent with the
// validator contract, which gates the same requirements on full-stack
// verticals).
const BACKEND_FEDERATION_WRAPPER_IDS: ReadonlySet<GeneratedToolingCommandId> =
  new Set(['backendFederationGenerate', 'backendFederationProof']);

interface MigratedWorkspaceScriptArtifact {
  relativePath: string;
  content: string;
  legacyPath?: string;
}

// Single source of truth for the workspace-owned scripts and tool wrappers that
// both fresh scaffolds and migrate must materialize. Deriving migrate's set
// from this list keeps it from drifting away from what the validator contract
// requires (validate-ultramodern-workspace.mjs.handlebars).
export function migratedWorkspaceScriptArtifacts(options: {
  shellOnly: boolean;
}): MigratedWorkspaceScriptArtifact[] {
  const artifacts: MigratedWorkspaceScriptArtifact[] = [
    {
      relativePath: 'scripts/check-ultramodern-i18n-boundaries.mts',
      content: createWorkspaceI18nBoundaryValidationScript(),
      legacyPath: 'scripts/check-ultramodern-i18n-boundaries.mjs',
    },
    {
      relativePath: 'scripts/check-ultramodern-api-boundaries.mts',
      content: createWorkspaceApiBoundaryValidationScript(),
      legacyPath: 'scripts/check-ultramodern-api-boundaries.mjs',
    },
    {
      relativePath: 'scripts/ultramodern-performance-readiness.config.mjs',
      content: createPerformanceReadinessConfigScript(),
    },
    {
      relativePath: 'scripts/bootstrap-agent-skills.mts',
      content: createSkillsToolWrapperScript(),
      legacyPath: 'scripts/bootstrap-agent-skills.mjs',
    },
    {
      relativePath: 'scripts/setup-agent-reference-repos.mts',
      content: createAgentReferenceReposSetupScript(),
      legacyPath: 'scripts/setup-agent-reference-repos.mjs',
    },
  ];

  for (const command of generatedToolingCommands) {
    if (options.shellOnly && BACKEND_FEDERATION_WRAPPER_IDS.has(command.id)) {
      continue;
    }
    artifacts.push({
      relativePath: command.wrapperPath,
      content: createToolWrapperScript(command.command),
      legacyPath: command.wrapperPath.replace(/\.mts$/u, '.mjs'),
    });
  }

  return artifacts;
}

// Basenames (under scripts/) of every workspace-owned script/wrapper that
// migrate renames from .mjs to .mts. Used to rewrite dangling package.json
// references so no script points at a deleted .mjs file after migrate.
export const migratedWorkspaceScriptBasenames: readonly string[] = [
  'check-ultramodern-i18n-boundaries',
  'check-ultramodern-api-boundaries',
  'bootstrap-agent-skills',
  'setup-agent-reference-repos',
  ...generatedToolingCommands.map(command => command.wrapperName),
];
