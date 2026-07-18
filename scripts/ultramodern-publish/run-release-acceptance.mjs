#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertReleaseAcceptanceProfile } from '../ultramodern-production-readiness/published-create-proof/acceptance-contract.mjs';
import { runAcceptanceProfile } from '../ultramodern-production-readiness/published-create-proof/acceptance-profile.mjs';
import {
  assertAcceptanceReceipt,
  readAcceptanceReceipt,
  verifyAcceptanceReceiptOperationalEvidence,
} from '../ultramodern-production-readiness/published-create-proof/acceptance-receipt.mjs';
import { generateVerticalNames } from '../ultramodern-production-readiness/published-create-proof/args.mjs';
import {
  defaultProjectName,
  scaleProfiles,
} from '../ultramodern-production-readiness/published-create-proof/constants.mjs';
import { readReleaseManifest } from './lib/source-create-proof/release-manifest.mjs';
import { startEphemeralRegistry } from './lib/source-create-proof/runtime-proof/registry.mjs';

const valueOptions = new Set([
  '--expected-source-revision',
  '--expected-mode',
  '--expected-version',
  '--manifest',
  '--mode',
  '--project-name',
  '--receipt',
  '--registry-url',
  '--release-age-policy',
  '--release-dir',
  '--run-identity',
  '--scale-profile',
]);
const booleanOptions = new Set(['--verify-receipt']);

function parseArgs(argv) {
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument.includes('=')) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    if (booleanOptions.has(argument)) {
      if (flags.has(argument)) {
        throw new Error(`Duplicate argument: ${argument}`);
      }
      flags.add(argument);
      continue;
    }
    if (!valueOptions.has(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    if (values.has(argument)) {
      throw new Error(`Duplicate argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${argument} requires a value`);
    }
    values.set(argument, value);
    index += 1;
  }

  const explicitMode = values.get('--mode');
  const verifyFlag = flags.has('--verify-receipt');
  if (verifyFlag && explicitMode && explicitMode !== 'verify') {
    throw new Error(
      '--verify-receipt cannot be combined with a non-verify --mode',
    );
  }
  const mode = verifyFlag ? 'verify' : (explicitMode ?? 'prepublish');
  if (!['prepublish', 'published', 'verify'].includes(mode)) {
    throw new Error('--mode must be prepublish, published, or verify');
  }
  const expectedMode = values.get('--expected-mode') ?? 'source';
  if (!['source', 'published'].includes(expectedMode)) {
    throw new Error('--expected-mode must be source or published');
  }
  if (mode !== 'verify' && values.has('--expected-mode')) {
    throw new Error('--expected-mode is only valid with receipt verification');
  }

  const releaseDirValue = values.get('--release-dir');
  const manifestValue = values.get('--manifest');
  if (!releaseDirValue && !manifestValue) {
    throw new Error('--release-dir or --manifest is required');
  }
  const manifestPath = path.resolve(
    manifestValue ?? path.join(releaseDirValue, 'manifest.json'),
  );
  const releaseDir = path.resolve(
    releaseDirValue ?? path.dirname(manifestPath),
  );
  if (manifestPath !== path.join(releaseDir, 'manifest.json')) {
    throw new Error(
      `Strict release manifest must be ${path.join(releaseDir, 'manifest.json')}`,
    );
  }

  const receipt = values.get('--receipt');
  if (!receipt) {
    throw new Error('--receipt is required');
  }
  const scaleProfile = values.get('--scale-profile') ?? 'erp-10';
  if (scaleProfile !== 'erp-10') {
    throw new Error('--scale-profile must be erp-10 for release acceptance');
  }
  const projectName = values.get('--project-name') ?? defaultProjectName;
  if (!/^[a-z][a-z0-9-]*$/u.test(projectName)) {
    throw new Error('--project-name must match /^[a-z][a-z0-9-]*$/');
  }

  return {
    expectedSourceRevision: values.get('--expected-source-revision'),
    expectedMode,
    expectedVersion: values.get('--expected-version'),
    manifestPath,
    mode,
    projectName,
    receiptPath: path.resolve(receipt),
    registryUrl: values.get('--registry-url') ?? 'https://registry.npmjs.org/',
    releaseAgePolicyPath: values.has('--release-age-policy')
      ? path.resolve(values.get('--release-age-policy'))
      : undefined,
    releaseDir,
    runIdentity: values.get('--run-identity'),
    scaleProfile,
  };
}

function assertExpectedRelease(release, options) {
  if (
    options.expectedSourceRevision &&
    release.source.commit !== options.expectedSourceRevision.toLowerCase()
  ) {
    throw new Error(
      `Release source commit ${release.source.commit} does not match expected ${options.expectedSourceRevision}`,
    );
  }
  if (
    options.expectedVersion &&
    release.release.version !== options.expectedVersion
  ) {
    throw new Error(
      `Release version ${release.release.version} does not match expected ${options.expectedVersion}`,
    );
  }
}

function resolveRunIdentity(release, explicit, env = process.env) {
  if (explicit) {
    if (explicit.trim() !== explicit || explicit.length < 3) {
      throw new Error('--run-identity must be a non-empty stable identity');
    }
    return explicit;
  }
  const repository = env.GITHUB_REPOSITORY;
  const runId = env.GITHUB_RUN_ID;
  const runAttempt = env.GITHUB_RUN_ATTEMPT;
  if (!repository || !runId || !runAttempt) {
    throw new Error(
      '--run-identity is required outside a GitHub Actions run with GITHUB_REPOSITORY, GITHUB_RUN_ID, and GITHUB_RUN_ATTEMPT',
    );
  }
  if (repository.toLowerCase() !== release.source.repository.toLowerCase()) {
    throw new Error(
      `Workflow repository ${repository} does not match release source ${release.source.repository}`,
    );
  }
  if (!/^\d+$/u.test(runId) || !/^\d+$/u.test(runAttempt)) {
    throw new Error('GitHub run id and attempt must be decimal integers');
  }
  return `github:${release.source.repository}:run:${runId}:attempt:${runAttempt}`;
}

function profileOptions(options) {
  const selectedProfile = scaleProfiles[options.scaleProfile];
  return assertReleaseAcceptanceProfile({
    selectedProfile,
    scaleProfile: selectedProfile.id,
    verticalCount: selectedProfile.verticalCount,
    verticals: generateVerticalNames(selectedProfile.verticalCount),
    projectName: options.projectName,
    createPackage: undefined,
    deployCloudflare: false,
  });
}

function verifyReceipt({ release, options, runIdentity }) {
  const receipt = readAcceptanceReceipt(options.receiptPath);
  const verified = assertAcceptanceReceipt(receipt, {
    release,
    profileId: options.scaleProfile,
    runIdentity,
    expectedMode: options.expectedMode,
  });
  verifyAcceptanceReceiptOperationalEvidence(receipt, options.receiptPath);
  return verified;
}

async function runPrepublish({ release, options, runIdentity }) {
  const registryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ultramodern-verdaccio-'),
  );
  let registry;
  try {
    registry = await startEphemeralRegistry({ release, rootDir: registryRoot });
    return await runAcceptanceProfile({
      mode: 'source',
      release,
      registryUrl: registry.registryUrl,
      registryEnv: registry.env,
      registryTool: registry.tool,
      options: profileOptions(options),
      outPath: options.receiptPath,
      runIdentity,
      releaseAgePolicyPath: options.releaseAgePolicyPath,
    });
  } finally {
    await registry?.stop();
    fs.rmSync(registryRoot, { recursive: true, force: true });
  }
}

async function runPublished({ release, options, runIdentity }) {
  const registryUrl = new URL(options.registryUrl).toString();
  return runAcceptanceProfile({
    mode: 'published',
    release,
    registryUrl,
    registryEnv: {
      npm_config_registry: registryUrl,
      pnpm_config_registry: registryUrl,
    },
    registryTool: { name: 'npm-registry' },
    options: profileOptions(options),
    outPath: options.receiptPath,
    runIdentity,
    releaseAgePolicyPath: options.releaseAgePolicyPath,
  });
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv);
  const release = readReleaseManifest({ manifestPath: options.manifestPath });
  assertExpectedRelease(release, options);
  if (options.mode === 'verify' && !options.runIdentity) {
    throw new Error(
      '--run-identity is required for receipt verification and must identify the accepted producer run',
    );
  }
  const runIdentity = resolveRunIdentity(release, options.runIdentity, env);
  if (options.mode === 'verify') {
    verifyReceipt({ release, options, runIdentity });
    process.stdout.write(
      `Verified ERP-10 acceptance receipt for ${release.release.version}.\n`,
    );
    return 0;
  }
  if (options.mode === 'published') {
    await runPublished({ release, options, runIdentity });
  } else {
    await runPrepublish({ release, options, runIdentity });
  }
  process.stdout.write(
    `ERP-10 exact-artifact acceptance passed for ${release.release.version}.\n`,
  );
  return 0;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    process.exitCode = await main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

export {
  assertExpectedRelease,
  main,
  parseArgs,
  profileOptions,
  resolveRunIdentity,
  verifyReceipt,
};
