import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCreatePackageRoot } from '../../create-package-root';
import {
  generatedToolingCommandList,
  generatedToolingCommands,
} from '../../ultramodern-workspace/tooling-command-catalog';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const createPackageRoot = resolveCreatePackageRoot(__dirname);

export type CommandContext = {
  workspaceRoot: string;
  invocationCwd: string;
};

export function printHelp() {
  const commands = [
    ...generatedToolingCommandList().map(command => `  ${command}`),
    '  skills install',
    '  skills check',
  ].join('\n');

  process.stdout.write(`Usage:
  ultramodern-create ultramodern <command> [args]

Commands:
${commands}
`);
}

export function spawnNodeScript(
  relativeScriptPath: string,
  args: string[],
  context: CommandContext,
  options: { cwd?: string } = {},
) {
  const scriptPath = path.join(createPackageRoot, relativeScriptPath);
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: options.cwd ?? context.workspaceRoot,
    env: {
      ...process.env,
      ULTRAMODERN_WORKSPACE_ROOT: context.workspaceRoot,
    },
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
}

export function runTemplateBackedToolingCommand(
  command: string,
  args: string[],
  context: CommandContext,
) {
  const toolingCommand = generatedToolingCommands.find(
    candidate => candidate.command === command,
  );
  if (!toolingCommand?.templatePath) {
    return undefined;
  }

  return spawnNodeScript(toolingCommand.templatePath, args, context, {
    cwd:
      toolingCommand.cwd === 'invocation'
        ? context.invocationCwd
        : context.workspaceRoot,
  });
}

export function runRenderedModule(source: string, context: CommandContext) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultramodern-tool-'));
  const tempFile = path.join(tempDir, 'command.mjs');

  try {
    fs.writeFileSync(tempFile, source, 'utf-8');
    const result = spawnSync(process.execPath, [tempFile], {
      cwd: context.workspaceRoot,
      stdio: 'inherit',
    });
    if (result.error) {
      throw result.error;
    }
    return result.status ?? 1;
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
}
