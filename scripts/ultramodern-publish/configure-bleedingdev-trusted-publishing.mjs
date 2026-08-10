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
const trustedPublisherRegistry = 'https://registry.npmjs.org/';
const trustedPublisherRepository = 'BleedingDev/ultramodern.js';
const trustedPublisherTargetPrefix = '@bleedingdev/modern-js-';
const trustedPublisherWorkflow = 'publish-bleedingdev.yml';

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
      repository: trustedPublisherRepository,
      file: trustedPublisherWorkflow,
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
  if (options.repository !== trustedPublisherRepository) {
    throw new Error(
      `Trusted publishing repository must be ${trustedPublisherRepository}`,
    );
  }
  if (options.file !== trustedPublisherWorkflow) {
    throw new Error(
      `Trusted publishing workflow must be ${trustedPublisherWorkflow}`,
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
  const { manifest } = verified;
  if (manifest.source.repository !== trustedPublisherRepository) {
    throw new Error(
      `Release manifest source repository must be ${trustedPublisherRepository}`,
    );
  }
  for (const item of manifest.packages) {
    if (!item.targetName.startsWith(trustedPublisherTargetPrefix)) {
      throw new Error(
        `Release manifest package ${item.targetName} is outside ${trustedPublisherTargetPrefix}`,
      );
    }
  }
  return manifest;
}

function run(command, args, { stdio = 'inherit' } = {}) {
  const result = runCommand(command, args, {
    cwd: repoRoot,
    encoding: 'utf-8',
    stdio,
    env: {
      ...process.env,
      FORCE_COLOR: '0',
    },
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with ${result.exitCode}${
        result.stderr ? `: ${result.stderr.trim()}` : ''
      }`,
    );
  }

  return result;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function requireTrustAllowPublishSupport() {
  const result = runCommand('npm', ['trust', 'github', '--help'], {
    cwd: repoRoot,
    encoding: 'utf-8',
    stdio: 'pipe',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
    },
  });

  const help = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (result.exitCode !== 0 || !/(?:^|\s)--allow-publish(?:\s|$)/u.test(help)) {
    throw new Error(
      'npm trust with --allow-publish support is required; refusing to configure trusted publishing',
    );
  }
}

function trustedPublisherArgs(packageName, options) {
  const args = [
    'trust',
    'github',
    packageName,
    '--repo',
    options.repository,
    '--file',
    options.file,
    '--allow-publish',
  ];

  args.push(
    '--env',
    trustedPublisherEnvironment,
    '--registry',
    trustedPublisherRegistry,
  );
  if (options.dryRun) {
    args.push('--dry-run');
  }
  if (options.yes) {
    args.push('--yes');
  }
  return args;
}

function parseTrustedPublisherList(stdout, packageName) {
  const serialized = stdout.trim();
  if (serialized === '') {
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new Error(
      `npm trust list returned invalid JSON for ${packageName}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const configurations = Array.isArray(parsed) ? parsed : [parsed];
  if (
    configurations.some(
      configuration =>
        !configuration ||
        typeof configuration !== 'object' ||
        Array.isArray(configuration),
    )
  ) {
    throw new Error(
      `npm trust list returned an invalid configuration for ${packageName}`,
    );
  }
  return configurations;
}

function isExactTrustedPublisher(configuration, options) {
  const keys = Object.keys(configuration).sort();
  const expectedKeys = [
    'environment',
    'file',
    'id',
    'permissions',
    'repository',
    'type',
  ].sort();
  return (
    JSON.stringify(keys) === JSON.stringify(expectedKeys) &&
    typeof configuration.id === 'string' &&
    configuration.id.length > 0 &&
    configuration.type === 'github' &&
    configuration.repository === options.repository &&
    configuration.file === options.file &&
    configuration.environment === trustedPublisherEnvironment &&
    Array.isArray(configuration.permissions) &&
    configuration.permissions.length === 1 &&
    configuration.permissions[0] === 'createPackage'
  );
}

function inspectTrustedPublisher(packageName, options) {
  const result = run(
    'npm',
    [
      'trust',
      'list',
      packageName,
      '--json',
      '--registry',
      trustedPublisherRegistry,
    ],
    { stdio: 'pipe' },
  );
  const configurations = parseTrustedPublisherList(result.stdout, packageName);
  if (configurations.length === 0) {
    return { packageName, status: 'absent' };
  }
  if (configurations.length !== 1) {
    throw new Error(
      `Expected zero or one npm trust configuration for ${packageName}; found ${configurations.length}`,
    );
  }
  if (!isExactTrustedPublisher(configurations[0], options)) {
    throw new Error(
      `Existing npm trust configuration for ${packageName} does not exactly match the required GitHub publish trust`,
    );
  }
  return { packageName, status: 'configured' };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = readManifest(options.manifest);
  requireTrustAllowPublishSupport();
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

  const inspected = packages.map(packageName =>
    inspectTrustedPublisher(packageName, options),
  );
  const absent = inspected.filter(item => item.status === 'absent');
  for (const item of inspected.filter(item => item.status === 'configured')) {
    console.log(`Already configured ${item.packageName}`);
  }

  for (const { packageName } of absent) {
    const args = trustedPublisherArgs(packageName, options);

    console.log(`Configuring ${packageName}`);
    run('npm', args);

    if (options.delayMs > 0) {
      sleep(options.delayMs);
    }
    if (!options.dryRun) {
      const verified = inspectTrustedPublisher(packageName, options);
      if (verified.status !== 'configured') {
        throw new Error(
          `npm trust creation postcondition failed for ${packageName}`,
        );
      }
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
