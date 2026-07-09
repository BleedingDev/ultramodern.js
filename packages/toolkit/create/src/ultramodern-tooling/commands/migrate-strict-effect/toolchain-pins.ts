import fs from 'node:fs';
import path from 'node:path';
import {
  NODE_VERSION,
  PNPM_VERSION,
} from '../../../ultramodern-workspace/versions';
import type { MigrationIo } from './io';

const NODE_ENGINE_RANGE = '>=26';
const PNPM_ENGINE_RANGE = '>=11';

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function updateUltramodernConfigToolchain(config: Record<string, any>) {
  const workspace = isRecord(config.workspace) ? config.workspace : {};
  config.workspace = workspace;

  const packageManager = isRecord(workspace.packageManager)
    ? workspace.packageManager
    : {};
  workspace.packageManager = packageManager;
  packageManager.name = 'pnpm';
  packageManager.version = PNPM_VERSION;

  const node = isRecord(workspace.node) ? workspace.node : {};
  workspace.node = node;
  node.version = NODE_VERSION;
  node.engineRange = NODE_ENGINE_RANGE;
}

export function updateRootPackageToolchain(packageJson: Record<string, any>) {
  packageJson.packageManager = `pnpm@${PNPM_VERSION}`;

  const engines = isRecord(packageJson.engines) ? packageJson.engines : {};
  packageJson.engines = engines;
  engines.node = NODE_ENGINE_RANGE;
  engines.pnpm = PNPM_ENGINE_RANGE;
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
    const index = lines.findIndex(
      (candidate, candidateIndex) =>
        candidateIndex > toolsStart &&
        candidateIndex < toolsEnd &&
        pattern.test(candidate),
    );
    if (index === -1) {
      lines.splice(toolsEnd, 0, line);
      toolsEnd += 1;
      return;
    }
    lines[index] = line;
  };

  upsertTool('node', NODE_VERSION);
  upsertTool('pnpm', PNPM_VERSION);

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
    `$1node-version: '${NODE_VERSION}'`,
  );
  io.write(workflowPath, updatedWorkflow);
}
