import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCreatePackageRoot } from '../create-package-root';
import { validateModuleFederationTypes } from '../ultramodern-workspace/mf-validation';
import { createWorkspaceValidationScript } from '../ultramodern-workspace/workspace-scripts';
import {
  readUltramodernConfig,
  workspaceAppsFromToolingConfig,
} from './config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const createPackageRoot = resolveCreatePackageRoot(__dirname);

type CommandContext = {
  workspaceRoot: string;
  invocationCwd: string;
};

function printHelp() {
  process.stdout.write(`Usage:
  modern-js-create ultramodern <command> [args]

Commands:
  validate
  typecheck
  mf-types
  public-surface
  cloudflare-proof
  performance-readiness
  skills install
  skills check
`);
}

function spawnNodeScript(
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

function runRenderedModule(source: string, context: CommandContext) {
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

function runValidate(context: CommandContext) {
  const config = readUltramodernConfig(context.workspaceRoot);
  const apps = workspaceAppsFromToolingConfig(config);
  const remotes = apps.filter(app => app.kind !== 'shell');
  const source = createWorkspaceValidationScript(
    config.workspace.packageScope,
    config.features.tailwind,
    remotes,
  );

  return runRenderedModule(source, context);
}

function runMfTypes(args: string[], context: CommandContext) {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`Usage:
  modern-js-create ultramodern mf-types [app-dir...]

Checks real Module Federation config files and DTS archives for exposed apps.
`);
    return 0;
  }

  validateModuleFederationTypes({
    workspaceRoot: context.workspaceRoot,
    appDirs: args.length > 0 ? args : undefined,
  });
  return 0;
}

function runSkills(args: string[], context: CommandContext) {
  const [subcommand, ...rest] = args;
  if (subcommand === 'install') {
    return spawnNodeScript(
      'template-workspace/scripts/bootstrap-agent-skills.mjs',
      rest,
      context,
    );
  }
  if (subcommand === 'check') {
    return spawnNodeScript(
      'template-workspace/scripts/bootstrap-agent-skills.mjs',
      ['--check', ...rest],
      context,
    );
  }

  throw new Error('Usage: modern-js-create ultramodern skills <install|check>');
}

export async function runUltramodernToolingCli(
  args: string[],
  workspaceRoot = process.env.ULTRAMODERN_WORKSPACE_ROOT ?? process.cwd(),
): Promise<number> {
  try {
    const [command, ...rest] = args;
    const context = {
      workspaceRoot: path.resolve(workspaceRoot),
      invocationCwd: process.cwd(),
    };

    switch (command) {
      case undefined:
      case '--help':
      case '-h':
        printHelp();
        return 0;
      case 'validate':
        return runValidate(context);
      case 'typecheck':
        return spawnNodeScript(
          'templates/workspace-scripts/ultramodern-typecheck.mjs',
          rest,
          context,
          { cwd: context.invocationCwd },
        );
      case 'mf-types':
        return runMfTypes(rest, context);
      case 'public-surface':
        return spawnNodeScript(
          'templates/workspace-scripts/generate-public-surface-assets.mjs',
          rest,
          context,
        );
      case 'cloudflare-proof':
        return spawnNodeScript(
          'templates/workspace-scripts/proof-cloudflare-version.mjs',
          rest,
          context,
        );
      case 'performance-readiness':
        return spawnNodeScript(
          'templates/workspace-scripts/ultramodern-performance-readiness.mjs',
          rest,
          context,
        );
      case 'skills':
        return runSkills(rest, context);
      default:
        throw new Error(`Unknown UltraModern command: ${command}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[ultramodern] ${message}\n`);
    return 1;
  }
}
