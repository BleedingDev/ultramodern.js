import fs from 'node:fs';
import path from 'node:path';
import {
  ULTRAMODERN_PACKAGE_PINS,
  ULTRAMODERN_WORKSPACE_POLICY,
} from '../../../ultramodern-workspace/policy';
import type { MigrationIo } from './io';

const { toolchain } = ULTRAMODERN_WORKSPACE_POLICY;
const retiredRootToolingDependencies = ['@typescript/typescript6'] as const;

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function ensureRecord(parent: Record<string, any>, key: string, label: string) {
  const value = parent[key];
  if (value === undefined) {
    const created: Record<string, any> = {};
    parent[key] = created;
    return created;
  }
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

export function updateUltramodernConfigToolchain(config: Record<string, any>) {
  const workspace = ensureRecord(config, 'workspace', 'workspace');
  const packageManager = ensureRecord(
    workspace,
    'packageManager',
    'workspace.packageManager',
  );
  packageManager.name = toolchain.packageManager.name;
  packageManager.version = toolchain.packageManager.version;

  const node = ensureRecord(workspace, 'node', 'workspace.node');
  node.version = toolchain.node.version;
  node.engineRange = toolchain.node.engineRange;
}

export function updateRootPackageToolchain(packageJson: Record<string, any>) {
  packageJson.packageManager = `${toolchain.packageManager.name}@${toolchain.packageManager.version}`;

  const engines = ensureRecord(packageJson, 'engines', 'package.json engines');
  engines.node = toolchain.node.engineRange;
  engines.pnpm = toolchain.packageManager.engineRange;

  const devDependencies = ensureRecord(
    packageJson,
    'devDependencies',
    'package.json devDependencies',
  );
  for (const packageName of retiredRootToolingDependencies) {
    delete devDependencies[packageName];
  }
  devDependencies['@typescript/native'] =
    ULTRAMODERN_PACKAGE_PINS.rootDevDependencies['@typescript/native'];
  devDependencies.miniflare =
    ULTRAMODERN_PACKAGE_PINS.rootDevDependencies.miniflare;
}

function updateMiseTools(content: string) {
  const lines = content.replace(/\r\n/gu, '\n').split('\n');
  if (lines.at(-1) === '') {
    lines.pop();
  }

  let toolsStart = lines.findIndex(line =>
    /^\s*\[tools\]\s*(?:#.*)?$/u.test(line),
  );
  if (toolsStart === -1) {
    if (lines.length > 0) {
      lines.push('');
    }
    toolsStart = lines.length;
    lines.push('[tools]');
  }

  const nextSection = lines.findIndex(
    (line, index) =>
      index > toolsStart && /^\s*\[[^\]]+\]\s*(?:#.*)?$/u.test(line),
  );
  let toolsEnd = nextSection === -1 ? lines.length : nextSection;
  const upsertTool = (name: 'node' | 'pnpm', version: string) => {
    const pattern = new RegExp(`^\\s*${name}\\s*=`, 'u');
    const line = `${name} = "${version}"`;
    const indexes = lines.flatMap((candidate, candidateIndex) =>
      candidateIndex > toolsStart &&
      candidateIndex < toolsEnd &&
      pattern.test(candidate)
        ? [candidateIndex]
        : [],
    );
    if (indexes.length > 1) {
      throw new Error(`.mise.toml [tools] contains duplicate ${name} pins.`);
    }
    const index = indexes[0];
    if (index === undefined) {
      lines.splice(toolsEnd, 0, line);
      toolsEnd += 1;
      return;
    }
    lines[index] = line;
  };

  upsertTool('node', toolchain.node.version);
  upsertTool('pnpm', toolchain.packageManager.version);

  return `${lines.join('\n')}\n`;
}

export function updateGeneratedToolchainFiles(io: MigrationIo) {
  const misePath = path.join(io.workspaceRoot, '.mise.toml');
  const miseContent = fs.existsSync(misePath)
    ? fs.readFileSync(misePath, 'utf-8')
    : '';
  io.write(misePath, updateMiseTools(miseContent));

  const workflowPath = path.join(
    io.workspaceRoot,
    '.github/workflows/ultramodern-workspace-gates.yml',
  );
  if (!fs.existsSync(workflowPath)) {
    return;
  }

  const workflow = fs.readFileSync(workflowPath, 'utf-8');
  const updatedWorkflow = workflow.replace(
    /^(\s*)node-version\s*:\s*.*$/mu,
    `$1node-version: '${toolchain.node.version}'`,
  );
  io.write(workflowPath, updatedWorkflow);
}
