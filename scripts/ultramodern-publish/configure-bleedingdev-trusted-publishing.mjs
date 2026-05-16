#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);

function parseArgs(argv) {
  const options = {
    manifest: path.join(
      repoRoot,
      '.modern',
      'bleedingdev-publish',
      'manifest.json',
    ),
    repository: 'BleedingDev/ultramodern.js',
    file: 'publish-bleedingdev.yml',
    environment: undefined,
    delayMs: 2000,
    dryRun: false,
    yes: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    }

    const readValue = () => {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${arg} requires a value`);
      }
      index += 1;
      return value;
    };

    if (arg === '--manifest') {
      options.manifest = path.resolve(readValue());
    } else if (arg === '--repository' || arg === '--repo') {
      options.repository = readValue();
    } else if (arg === '--file') {
      options.file = readValue();
    } else if (arg === '--environment' || arg === '--env') {
      options.environment = readValue();
    } else if (arg === '--delay-ms') {
      options.delayMs = Number(readValue());
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--no-yes') {
      options.yes = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

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

function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = readManifest(options.manifest);
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
