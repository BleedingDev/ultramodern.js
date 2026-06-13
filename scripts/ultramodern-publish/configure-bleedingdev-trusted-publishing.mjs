#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import cliKit from '../lib/cli-kit.js';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const { parseCliArgs } = cliKit;

function rejectInlineOptionSyntax(argv) {
  for (const arg of argv) {
    if (/^--[^=]+=/.test(arg)) {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
}

function parseArgs(argv) {
  rejectInlineOptionSyntax(argv);

  const options = parseCliArgs(argv, {
    defaults: {
      manifest: path.join(
        repoRoot,
        '.modern',
        'bleedingdev-publish',
        'manifest.json',
      ),
      repository: 'BleedingDev/ultramodern.js',
      file: 'publish-bleedingdev.yml',
      environment: undefined,
      delayMs: '2000',
      dryRun: false,
      yes: true,
    },
    ignoreTerminator: true,
    options: {
      manifest: {},
      repository: {},
      repo: {
        key: 'repository',
      },
      file: {},
      environment: {},
      env: {
        key: 'environment',
      },
      'delay-ms': {
        key: 'delayMs',
      },
      'dry-run': {
        key: 'dryRun',
        type: 'boolean',
      },
      'no-yes': {
        key: 'yes',
        type: 'boolean',
      },
    },
  });

  if (argv.includes('--no-yes')) {
    options.yes = false;
  }

  options.manifest = path.resolve(options.manifest);
  options.delayMs = Number(options.delayMs);
  if (!Number.isFinite(options.delayMs) || options.delayMs < 0) {
    throw new Error('--delay-ms must be a non-negative number');
  }

  return options;
}

function readManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `Missing publish manifest at ${manifestPath}. Run ultramodern:prepare-bleedingdev-publish first.`,
    );
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.packages)) {
    throw new Error(`Invalid publish manifest: ${manifestPath}`);
  }

  return manifest;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
    },
  });

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with ${result.status}`,
    );
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function supportsTrustAllowPublishFlag() {
  const result = spawnSync('npm', ['trust', 'github', '--help'], {
    cwd: repoRoot,
    encoding: 'utf-8',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
    },
  });

  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`.includes(
    '--allow-publish',
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = readManifest(options.manifest);
  const includeAllowPublish = supportsTrustAllowPublishFlag();
  const packages = manifest.packages
    .map(item => item.targetName)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  console.log(
    `Configuring GitHub trusted publishing for ${packages.length} package(s).`,
  );
  console.log(`Repository: ${options.repository}`);
  console.log(`Workflow: ${options.file}`);

  for (const packageName of packages) {
    const args = [
      'trust',
      'github',
      packageName,
      '--repo',
      options.repository,
      '--file',
      options.file,
    ];

    if (includeAllowPublish) {
      args.push('--allow-publish');
    }
    if (options.environment) {
      args.push('--env', options.environment);
    }
    if (options.dryRun) {
      args.push('--dry-run');
    }
    if (options.yes) {
      args.push('--yes');
    }

    console.log(`Configuring ${packageName}`);
    run('npm', args);

    if (options.delayMs > 0) {
      sleep(options.delayMs);
    }
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
