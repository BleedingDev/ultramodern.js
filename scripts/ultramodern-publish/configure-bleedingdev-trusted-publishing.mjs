#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cliKit from '../lib/cli-kit.js';
import fsKit from '../lib/fs-kit.js';
import processKit from '../lib/process-kit.js';
import { verifyReleaseArtifacts } from './lib/prepare-bleedingdev-packages/release-artifacts.mjs';

const { parseCliArgs } = cliKit;
const { repoRoot } = fsKit;
const { runCommand } = processKit;
const trustedPublisherEnvironment = 'npm-publish';

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
      environment: trustedPublisherEnvironment,
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
  if (options.environment !== trustedPublisherEnvironment) {
    throw new Error(
      `Trusted publishing environment must be ${trustedPublisherEnvironment}`,
    );
  }

  return options;
}

function readManifest(manifestPath) {
  const verified = verifyReleaseArtifacts(path.dirname(manifestPath));
  if (verified.manifestPath !== manifestPath) {
    throw new Error(
      `Verified release manifest path mismatch: expected ${manifestPath}, found ${verified.manifestPath}`,
    );
  }
  return verified.manifest;
}

function run(command, args) {
  const result = runCommand(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
    },
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with ${result.exitCode}`,
    );
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function supportsTrustAllowPublishFlag() {
  const result = runCommand('npm', ['trust', 'github', '--help'], {
    cwd: repoRoot,
    encoding: 'utf-8',
    stdio: 'pipe',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
    },
  });

  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`.includes(
    '--allow-publish',
  );
}

function trustedPublisherArgs(packageName, options, includeAllowPublish) {
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
  args.push('--env', trustedPublisherEnvironment);
  if (options.dryRun) {
    args.push('--dry-run');
  }
  if (options.yes) {
    args.push('--yes');
  }
  return args;
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
  console.log(`Environment: ${trustedPublisherEnvironment}`);

  for (const packageName of packages) {
    const args = trustedPublisherArgs(
      packageName,
      options,
      includeAllowPublish,
    );

    console.log(`Configuring ${packageName}`);
    run('npm', args);

    if (options.delayMs > 0) {
      sleep(options.delayMs);
    }
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

export { main, parseArgs, readManifest, trustedPublisherArgs };
