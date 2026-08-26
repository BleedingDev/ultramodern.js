#!/usr/bin/env node
// Consumer: operators recovering a published cohort whose GitHub release record was skipped.
// Create the GitHub release for a cohort version that was already published to
// npm but never got its change record.
//
// The current `publish-change-record` job overrides skipped-ancestor
// propagation and requires its authenticated outcome dependency to succeed.
// Older workflow revisions lacked that guard, so their release-record job was
// skipped after an otherwise successful publication and cannot re-enter the
// graph through `gh run rerun --failed`. A full re-dispatch is not an option
// either -- the publish job runs first and would refuse an already published
// version. Historical recovery therefore happens here, out of band.
//
// This deliberately stays a local script rather than a second CI write path.
//
// Usage:
//   node scripts/ultramodern-publish/backfill-change-record.mjs \
//     --version 3.5.0-ultramodern.102 \
//     --commit ea21b8ba12e3e68ce529622b8b93b63fd4345018 \
//     --run-id 31386576796 \
//     --run-attempt 2 \
//     [--dry-run]

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs, { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { RELEASE_TAG_PREFIX } from './gen-cohort-change-record.mjs';
import {
  dsseInTotoPayloadType,
  slsaProvenanceV1,
  verifyRegistryProvenance,
} from './lib/prepare-bleedingdev-packages/provenance.mjs';
import {
  assertRegistryDistMatches,
  lookupRegistryPackageDist,
  verifyRegistryDistTag,
  verifyRegistryPackageDist,
  verifyRegistryTarball,
} from './lib/prepare-bleedingdev-packages/registry.mjs';
import {
  createRegistryProvenanceExpectation,
  validateRegistryCohort,
  verifyRegistryPackage,
  verifyReleaseArtifacts,
} from './prepare-bleedingdev-packages.mjs';
import {
  publishOutcomeArtifactName,
  selectPublishOutcomeArtifact,
} from './publish-outcome.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const trustedRepository = 'BleedingDev/ultramodern.js';
const trustedOwner = 'BleedingDev';
const trustedRemote = 'bleedingdev';
const trustedBranch = 'main-ultramodern';
const trustedRef = `refs/heads/${trustedBranch}`;
const trustedWorkflowPath = '.github/workflows/publish-bleedingdev.yml';
const exactVersionPattern = /^\d+\.\d+\.\d+-ultramodern\.[1-9]\d*$/u;
const commitPattern = /^[a-f0-9]{40}$/u;
const positiveDecimalPattern = /^[1-9]\d*$/u;
const requiredArtifactFiles = new Set([
  'acceptance-receipt.json',
  'acceptance-receipt.operational-independence.json',
  'cohort.sha256',
  'manifest.json',
  'manifest.json.sha256',
  'publish-outcome.json',
  'published-acceptance-receipt.json',
  'tractor-downstream-acceptance.json',
]);
const historicalArtifactFiles = new Set([
  'published-acceptance-receipt.operational-independence.json',
]);
const tarballEntryPattern = /^tarballs\/[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/u;

function run(file, args, options = {}) {
  return execFileSync(file, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
    ...options,
  });
}

function runText(file, args, options) {
  const result = run(file, args, options);
  if (Buffer.isBuffer(result)) {
    return result.toString('utf8').trim();
  }
  return result?.trim() ?? '';
}

function parseJsonCommand(file, args, label) {
  const output = runText(file, args);
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(
      `${label} returned invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function readJsonFile(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(
      `${label} is invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function parsePositiveDecimal(value, label) {
  if (typeof value !== 'string' || !positiveDecimalPattern.test(value)) {
    throw new Error(`${label} must be a canonical positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label} exceeds Number.MAX_SAFE_INTEGER`);
  }
  return parsed;
}

function parseArgs(argv) {
  const parsed = {
    dryRun: false,
    repo: trustedRepository,
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (seen.has(arg)) {
      throw new Error(`duplicate argument: ${arg}`);
    }
    seen.add(arg);
    if (arg === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }
    if (
      ![
        '--version',
        '--commit',
        '--repo',
        '--run-id',
        '--run-attempt',
      ].includes(arg)
    ) {
      throw new Error(`unknown argument: ${arg}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${arg} requires a value`);
    }
    if (arg === '--version') {
      parsed.version = value;
    } else if (arg === '--commit') {
      parsed.commit = value;
    } else if (arg === '--repo') {
      parsed.repo = value;
    } else if (arg === '--run-id') {
      parsed.runId = value;
    } else {
      parsed.runAttempt = value;
    }
    index += 1;
  }
  for (const [name, value] of [
    ['--version', parsed.version],
    ['--commit', parsed.commit],
    ['--run-id', parsed.runId],
    ['--run-attempt', parsed.runAttempt],
  ]) {
    if (value === undefined) {
      throw new Error(`${name} is required`);
    }
  }
  if (!exactVersionPattern.test(parsed.version)) {
    throw new Error(
      '--version must be an exact x.y.z-ultramodern.N release version',
    );
  }
  if (!commitPattern.test(parsed.commit)) {
    throw new Error('--commit must be a full lowercase 40-character Git SHA');
  }
  if (parsed.repo !== trustedRepository) {
    throw new Error(
      `--repo must be the trusted publish repository ${trustedRepository}`,
    );
  }
  parsed.runId = String(parsePositiveDecimal(parsed.runId, '--run-id'));
  parsed.runAttempt = parsePositiveDecimal(parsed.runAttempt, '--run-attempt');
  return parsed;
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value;
}

function assertTrustedWorkflowRun(workflowRun, options) {
  assertObject(workflowRun, 'Workflow run');
  const repository = assertObject(
    workflowRun.repository,
    'Workflow run repository',
  );
  const headRepository = assertObject(
    workflowRun.head_repository,
    'Workflow run head repository',
  );
  const actor = assertObject(workflowRun.actor, 'Workflow run actor');
  const triggeringActor = assertObject(
    workflowRun.triggering_actor,
    'Workflow run triggering actor',
  );
  if (
    String(workflowRun.id) !== options.runId ||
    workflowRun.run_attempt !== options.runAttempt
  ) {
    throw new Error('Workflow run does not match the required run attempt');
  }
  if (
    repository.full_name !== trustedRepository ||
    headRepository.full_name !== trustedRepository
  ) {
    throw new Error('Workflow run does not belong to the trusted repository');
  }
  if (
    workflowRun.path !== trustedWorkflowPath ||
    workflowRun.event !== 'workflow_dispatch'
  ) {
    throw new Error('Workflow run is not the trusted publish workflow');
  }
  if (
    workflowRun.head_branch !== trustedBranch ||
    workflowRun.head_sha !== options.commit
  ) {
    throw new Error(
      'Workflow run does not match the trusted branch and source commit',
    );
  }
  if (
    workflowRun.status !== 'completed' ||
    workflowRun.conclusion !== 'success'
  ) {
    throw new Error('Workflow run attempt did not complete successfully');
  }
  if (actor.login !== trustedOwner || triggeringActor.login !== trustedOwner) {
    throw new Error('Workflow run was not dispatched by the repository owner');
  }
  if (
    !Number.isSafeInteger(repository.id) ||
    !Number.isSafeInteger(headRepository.id) ||
    repository.id !== headRepository.id
  ) {
    throw new Error('Workflow run repository identity is incomplete');
  }
  if (
    typeof workflowRun.updated_at !== 'string' ||
    !Number.isFinite(Date.parse(workflowRun.updated_at))
  ) {
    throw new Error('Workflow run completion timestamp is invalid');
  }
  return workflowRun;
}

function loadTrustedWorkflowRun(options) {
  const workflowRun = parseJsonCommand(
    'gh',
    [
      'api',
      '--method',
      'GET',
      `repos/${trustedRepository}/actions/runs/${options.runId}/attempts/${options.runAttempt}`,
    ],
    'GitHub workflow run API',
  );
  return assertTrustedWorkflowRun(workflowRun, options);
}

function assertTrustedOutcomeArtifact(artifact, workflowRun, options) {
  assertObject(artifact, 'Publish outcome artifact');
  const artifactRun = assertObject(
    artifact.workflow_run,
    'Publish outcome artifact workflow run',
  );
  if (
    !Number.isSafeInteger(artifact.id) ||
    artifact.id <= 0 ||
    !Number.isSafeInteger(artifact.size_in_bytes) ||
    artifact.size_in_bytes <= 0 ||
    typeof artifact.digest !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/u.test(artifact.digest) ||
    artifact.name !==
      publishOutcomeArtifactName({
        runAttempt: options.runAttempt,
        runId: options.runId,
      }) ||
    artifact.expired !== false ||
    typeof artifact.created_at !== 'string' ||
    !Number.isFinite(Date.parse(artifact.created_at)) ||
    Date.parse(artifact.created_at) > Date.parse(workflowRun.updated_at) ||
    artifactRun.id !== workflowRun.id ||
    artifactRun.head_branch !== trustedBranch ||
    artifactRun.head_sha !== options.commit ||
    artifactRun.repository_id !== workflowRun.repository.id ||
    artifactRun.head_repository_id !== workflowRun.head_repository.id
  ) {
    throw new Error(
      'Publish outcome artifact does not belong to the trusted workflow run',
    );
  }
  return artifact;
}

function loadTrustedOutcomeArtifact(workflowRun, options) {
  const pages = parseJsonCommand(
    'gh',
    [
      'api',
      '--method',
      'GET',
      '--paginate',
      '--slurp',
      `repos/${trustedRepository}/actions/runs/${options.runId}/artifacts?per_page=100`,
    ],
    'GitHub workflow artifact API',
  );
  const artifact = selectPublishOutcomeArtifact(pages, {
    completedAt: workflowRun.updated_at,
    runAttempt: options.runAttempt,
    runId: options.runId,
  });
  return assertTrustedOutcomeArtifact(artifact, workflowRun, options);
}

function validateOutcomeArchiveEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('Publish outcome archive is empty');
  }
  const seen = new Set();
  let tarballCount = 0;
  for (const entry of entries) {
    if (
      typeof entry !== 'string' ||
      entry === '' ||
      entry.includes('\\') ||
      path.posix.isAbsolute(entry) ||
      path.posix.normalize(entry) !== entry ||
      seen.has(entry)
    ) {
      throw new Error(`Unsafe publish outcome archive entry: ${String(entry)}`);
    }
    seen.add(entry);
    if (tarballEntryPattern.test(entry)) {
      tarballCount += 1;
    } else if (
      !requiredArtifactFiles.has(entry) &&
      !historicalArtifactFiles.has(entry)
    ) {
      throw new Error(`Unexpected publish outcome archive entry: ${entry}`);
    }
  }
  for (const required of requiredArtifactFiles) {
    if (!seen.has(required)) {
      throw new Error(`Publish outcome archive is missing ${required}`);
    }
  }
  if (tarballCount === 0) {
    throw new Error('Publish outcome archive contains no package tarballs');
  }
  return entries;
}

function assertExtractedArtifactFiles(artifactDir, entries) {
  for (const entry of entries) {
    const entryPath = path.resolve(artifactDir, entry);
    const relative = path.relative(artifactDir, entryPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Extracted artifact escaped its root: ${entry}`);
    }
    const stat = fs.lstatSync(entryPath, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.isSymbolicLink()) {
      throw new Error(
        `Extracted artifact entry is not a regular file: ${entry}`,
      );
    }
  }
}

function downloadTrustedOutcomeArtifact(artifact, workDir) {
  const archivePath = path.join(workDir, 'publish-outcome.zip');
  const artifactDir = path.join(workDir, 'publish-outcome');
  fs.mkdirSync(artifactDir);
  const archive = run(
    'gh',
    [
      'api',
      '--method',
      'GET',
      `repos/${trustedRepository}/actions/artifacts/${artifact.id}/zip`,
    ],
    { encoding: null, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  if (!Buffer.isBuffer(archive) || archive.length === 0) {
    throw new Error('GitHub returned an empty publish outcome archive');
  }
  const archiveDigest = `sha256:${crypto
    .createHash('sha256')
    .update(archive)
    .digest('hex')}`;
  if (
    archive.length !== artifact.size_in_bytes ||
    archiveDigest !== artifact.digest
  ) {
    throw new Error(
      'Downloaded publish outcome archive does not match GitHub artifact bytes',
    );
  }
  fs.writeFileSync(archivePath, archive, { flag: 'wx' });
  const entries = validateOutcomeArchiveEntries(
    runText('unzip', ['-Z1', archivePath]).split('\n').filter(Boolean),
  );
  run('unzip', ['-q', archivePath, '-d', artifactDir], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  assertExtractedArtifactFiles(artifactDir, entries);
  return artifactDir;
}

function verifyPublishOutcomeAtSourceCommit(
  outcome,
  artifactDir,
  artifact,
  options,
) {
  const workDir = path.dirname(artifactDir);
  const archivePath = path.join(workDir, 'source-validator.tar');
  const reconstructedOutcomePath = path.join(
    workDir,
    'reconstructed-publish-outcome.json',
  );
  const validatorRoot = path.join(workDir, 'source-validator');
  const expectedOutcomeKeys = [
    'artifactName',
    'dryRun',
    'evidence',
    'producer',
    'publication',
    'release',
    'schema',
    'schemaVersion',
    'source',
    'workflowRun',
  ];
  const actualOutcomeKeys = Object.keys(
    assertObject(outcome, 'Publish outcome'),
  ).sort();
  if (!isDeepStrictEqual(actualOutcomeKeys, expectedOutcomeKeys.sort())) {
    throw new Error('Publish outcome has unknown or missing fields');
  }
  if (
    outcome.schema !== 'bleedingdev.ultramodern.publish-outcome' ||
    ![4, 5].includes(outcome.schemaVersion)
  ) {
    throw new Error('Publish outcome schema is not recoverable');
  }
  if (outcome.dryRun !== false || outcome.publication === null) {
    throw new Error('Publish outcome is not a completed publication');
  }
  const publishedOperationalEvidencePath = path.join(
    artifactDir,
    'published-acceptance-receipt.operational-independence.json',
  );
  const hasPublishedOperationalEvidence = fs.existsSync(
    publishedOperationalEvidencePath,
  );
  if (
    (outcome.schemaVersion === 4 && !hasPublishedOperationalEvidence) ||
    (outcome.schemaVersion === 5 && hasPublishedOperationalEvidence)
  ) {
    throw new Error(
      'Publish outcome archive does not match its schema operational evidence profile',
    );
  }
  const sourceArchive = run(
    'git',
    ['archive', '--format=tar', options.commit, 'scripts'],
    { encoding: null, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  if (!Buffer.isBuffer(sourceArchive) || sourceArchive.length === 0) {
    throw new Error('Exact publish source validator archive is empty');
  }
  fs.writeFileSync(archivePath, sourceArchive, { flag: 'wx' });
  fs.mkdirSync(validatorRoot);
  run('tar', ['-xf', archivePath, '-C', validatorRoot], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const validatorScriptPath = fs.realpathSync(
    path.join(validatorRoot, 'scripts/ultramodern-publish/publish-outcome.mjs'),
  );
  const createArgs = [
    validatorScriptPath,
    'create',
    '--manifest',
    path.join(artifactDir, 'manifest.json'),
    '--manifest-digest',
    path.join(artifactDir, 'manifest.json.sha256'),
    '--cohort-digest',
    path.join(artifactDir, 'cohort.sha256'),
    '--receipt',
    path.join(artifactDir, 'acceptance-receipt.json'),
    '--operational-evidence',
    path.join(artifactDir, 'acceptance-receipt.operational-independence.json'),
    '--published-receipt',
    path.join(artifactDir, 'published-acceptance-receipt.json'),
    '--tractor-report',
    path.join(artifactDir, 'tractor-downstream-acceptance.json'),
    '--tractor-report-sha256',
    outcome.evidence?.tractorAcceptance?.reportSha256,
    '--tractor-baseline-revision',
    outcome.evidence?.tractorAcceptance?.baselineRevision,
    '--out',
    reconstructedOutcomePath,
    '--repository',
    trustedRepository,
    '--source-commit',
    options.commit,
    '--run-id',
    options.runId,
    '--run-attempt',
    String(options.runAttempt),
    '--publication-run-attempt',
    String(outcome.publication?.runAttempt),
    '--producer-artifact-identity',
    outcome.producer?.artifactIdentity,
    '--producer-run-attempt',
    String(outcome.producer?.runAttempt),
    '--producer-run-identity',
    outcome.producer?.runIdentity,
    '--version',
    options.version,
    '--tag',
    'latest',
    '--dry-run',
    'false',
  ];
  if (outcome.schemaVersion === 4) {
    createArgs.splice(
      createArgs.indexOf('--published-receipt'),
      0,
      '--published-operational-evidence',
      publishedOperationalEvidencePath,
    );
  }
  run('node', createArgs, { stdio: ['ignore', 'ignore', 'inherit'] });
  const reconstructedOutcome = readJsonFile(
    reconstructedOutcomePath,
    'Reconstructed publish outcome',
  );
  if (
    artifact.name !== outcome.artifactName ||
    !isDeepStrictEqual(reconstructedOutcome, outcome)
  ) {
    throw new Error(
      'Publish outcome does not match the exact source validator reconstruction',
    );
  }
  return outcome;
}

function assertAuthenticatedRegistryInvocation(document, expected) {
  if (!document || !Array.isArray(document.attestations)) {
    throw new Error('Verified registry provenance document is unavailable');
  }
  const attestations = [
    ...new Map(
      document.attestations
        .filter(attestation => attestation?.predicateType === slsaProvenanceV1)
        .map(attestation => [JSON.stringify(attestation.bundle), attestation]),
    ).values(),
  ];
  if (attestations.length !== 1) {
    throw new Error(
      'Verified registry provenance does not have one SLSA statement',
    );
  }
  const envelope = attestations[0].bundle?.dsseEnvelope;
  if (envelope?.payloadType !== dsseInTotoPayloadType) {
    throw new Error('Verified registry provenance has the wrong payload type');
  }
  let statement;
  try {
    statement = JSON.parse(Buffer.from(envelope.payload, 'base64').toString());
  } catch (error) {
    throw new Error(
      `Verified registry provenance statement is unreadable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const invocationId = statement?.predicate?.runDetails?.metadata?.invocationId;
  const match = new RegExp(
    `^https://github\\.com/${trustedRepository.replace('.', '\\.')}/actions/runs/([1-9]\\d*)/attempts/([1-9]\\d*)$`,
    'u',
  ).exec(invocationId);
  const actualRunId = match?.[1];
  const actualAttempt = match ? Number(match[2]) : Number.NaN;
  if (
    actualRunId !== expected.runId ||
    !Number.isSafeInteger(actualAttempt) ||
    actualAttempt < expected.producerRunAttempt ||
    actualAttempt > expected.publicationRunAttempt
  ) {
    throw new Error(
      `Registry provenance invocation ${String(
        invocationId,
      )} is outside authenticated publication run ${expected.runId} attempts ${expected.producerRunAttempt}..${expected.publicationRunAttempt}`,
    );
  }
  return invocationId;
}

async function verifyAuthenticatedRegistryProvenance(
  item,
  dist,
  expectation,
  invocationWindow,
  runtime = {
    fetch: globalThis.fetch,
    verifyRegistryProvenance,
  },
) {
  let documentPromise;
  const capturingFetch = async (...args) => {
    const response = await runtime.fetch(...args);
    if (!response || typeof response.clone !== 'function') {
      throw new Error('Registry provenance response cannot be authenticated');
    }
    documentPromise = response
      .clone()
      .json()
      .then(
        value => ({ value }),
        error => ({ error }),
      );
    return response;
  };
  const verified = await runtime.verifyRegistryProvenance(
    item,
    dist,
    expectation,
    capturingFetch,
  );
  if (!documentPromise) {
    throw new Error(
      'Registry provenance verifier did not fetch an attestation',
    );
  }
  const captured = await documentPromise;
  if (captured.error) {
    throw new Error('Verified registry provenance document is unreadable', {
      cause: captured.error,
    });
  }
  assertAuthenticatedRegistryInvocation(captured.value, invocationWindow);
  return verified;
}

async function verifyAuthenticatedRegistryPackage(
  item,
  expectation,
  invocationWindow,
) {
  return verifyRegistryPackage(item, expectation, {
    assertRegistryDistMatches,
    lookupRegistryPackageDist,
    verifyRegistryPackageDist,
    verifyRegistryProvenance: (registryItem, dist, registryExpectation) =>
      verifyAuthenticatedRegistryProvenance(
        registryItem,
        dist,
        registryExpectation,
        invocationWindow,
      ),
    verifyRegistryTarball,
  });
}

async function verifyBackfillEvidence(
  artifactDir,
  artifact,
  options,
  validators = {
    createRegistryProvenanceExpectation,
    validateRegistryCohort,
    verifyRegistryDistTag,
    verifyRegistryPackage: verifyAuthenticatedRegistryPackage,
    verifyPublishOutcome: verifyPublishOutcomeAtSourceCommit,
    verifyReleaseArtifacts,
  },
) {
  const verifiedRelease = validators.verifyReleaseArtifacts(artifactDir, {
    source: { commit: options.commit, repository: trustedRepository },
    tag: 'latest',
    version: options.version,
  });
  const outcomePath = path.join(artifactDir, 'publish-outcome.json');
  const outcome = readJsonFile(outcomePath, 'Publish outcome');
  validators.verifyPublishOutcome(outcome, artifactDir, artifact, options);
  if (
    outcome.dryRun !== false ||
    !outcome.publication ||
    !Number.isSafeInteger(outcome.publication.runAttempt) ||
    outcome.publication.runAttempt <= 0 ||
    outcome.publication.runAttempt > options.runAttempt ||
    !outcome.producer ||
    !Number.isSafeInteger(outcome.producer.runAttempt) ||
    outcome.producer.runAttempt <= 0 ||
    outcome.producer.runAttempt > outcome.publication.runAttempt ||
    outcome.release?.version !== options.version ||
    outcome.release?.tag !== 'latest' ||
    outcome.source?.repository !== trustedRepository ||
    outcome.source?.commit !== options.commit
  ) {
    throw new Error(
      'Publish outcome is not a completed publication for the requested release',
    );
  }
  const provenanceExpectation = validators.createRegistryProvenanceExpectation(
    verifiedRelease.manifest,
    {
      GITHUB_REF: trustedRef,
      GITHUB_REPOSITORY: trustedRepository,
      GITHUB_RUN_ATTEMPT: String(outcome.publication.runAttempt),
      GITHUB_RUN_ID: options.runId,
    },
  );
  await validators.validateRegistryCohort(
    verifiedRelease.manifest,
    { dryRun: false, tag: verifiedRelease.manifest.release.tag },
    {
      verifyRegistryDistTag: validators.verifyRegistryDistTag,
      verifyRegistryPackage: item =>
        validators.verifyRegistryPackage(item, provenanceExpectation, {
          producerRunAttempt: outcome.producer.runAttempt,
          publicationRunAttempt: outcome.publication.runAttempt,
          runId: options.runId,
        }),
    },
  );
  return { outcome, verifiedRelease };
}

function normalizedGithubRepository(remoteUrl) {
  const scpMatch = /^git@github\.com:([^/\s]+\/[^/\s]+?)(?:\.git)?$/u.exec(
    remoteUrl,
  );
  if (scpMatch) {
    return scpMatch[1];
  }
  let parsed;
  try {
    parsed = new URL(remoteUrl);
  } catch {
    return null;
  }
  if (parsed.hostname.toLowerCase() !== 'github.com') {
    return null;
  }
  return parsed.pathname.replace(/^\//u, '').replace(/\.git$/u, '');
}

function assertTrustedCommitReachability(options) {
  const remoteUrl = runText('git', ['remote', 'get-url', trustedRemote]);
  if (
    normalizedGithubRepository(remoteUrl)?.toLowerCase() !==
    trustedRepository.toLowerCase()
  ) {
    throw new Error(
      `${trustedRemote} remote does not point at ${trustedRepository}`,
    );
  }
  const resolvedCommit = runText('git', [
    'rev-parse',
    '--verify',
    `${options.commit}^{commit}`,
  ]);
  if (resolvedCommit !== options.commit) {
    throw new Error('Requested commit did not resolve to the exact object');
  }
  run('git', [
    'fetch',
    '--no-tags',
    '--no-write-fetch-head',
    trustedRemote,
    `+${trustedRef}:refs/remotes/${trustedRemote}/${trustedBranch}`,
  ]);
  try {
    run('git', [
      'merge-base',
      '--is-ancestor',
      options.commit,
      `refs/remotes/${trustedRemote}/${trustedBranch}`,
    ]);
  } catch {
    throw new Error(
      `commit ${options.commit} is not reachable from ${trustedRemote}/${trustedBranch}`,
    );
  }
  return resolvedCommit;
}

function existingRemoteTagCommit(tag) {
  const output = runText('git', [
    'ls-remote',
    '--tags',
    trustedRemote,
    `refs/tags/${tag}`,
    `refs/tags/${tag}^{}`,
  ]);
  const lines = output.split('\n').filter(Boolean);
  if (lines.length === 0) {
    return null;
  }
  const dereferenced = lines.find(line => line.endsWith('^{}'));
  return (dereferenced ?? lines[0]).split(/\s+/u)[0];
}

function createDefaultOperations() {
  return {
    assertCommitReachable: assertTrustedCommitReachability,
    createRelease: releaseArgs => runText('gh', releaseArgs),
    createTemporaryDirectory: () =>
      mkdtempSync(path.join(tmpdir(), 'ultramodern-change-record-')),
    downloadOutcomeArtifact: downloadTrustedOutcomeArtifact,
    existingTagCommit: existingRemoteTagCommit,
    fetchTags: () =>
      run('git', [
        'fetch',
        '--no-tags',
        '--no-write-fetch-head',
        trustedRemote,
        '+refs/tags/*:refs/tags/*',
      ]),
    generateChangeRecord: ({ recordPath, sha, version }) =>
      run(
        'node',
        [
          'scripts/ultramodern-publish/gen-cohort-change-record.mjs',
          '--version',
          version,
          '--out',
          recordPath,
        ],
        {
          env: {
            ...process.env,
            GITHUB_REPOSITORY: trustedRepository,
            GITHUB_SHA: sha,
          },
          stdio: ['ignore', 'inherit', 'inherit'],
        },
      ),
    loadOutcomeArtifact: loadTrustedOutcomeArtifact,
    loadWorkflowRun: loadTrustedWorkflowRun,
    removeTemporaryDirectory: directory =>
      fs.rmSync(directory, { force: true, recursive: true }),
    verifyEvidence: verifyBackfillEvidence,
  };
}

async function executeBackfill(
  options,
  operations = createDefaultOperations(),
) {
  const workflowRun = await operations.loadWorkflowRun(options);
  assertTrustedWorkflowRun(workflowRun, options);
  const sha = await operations.assertCommitReachable(options);
  if (sha !== options.commit) {
    throw new Error('Reachability proof returned the wrong source commit');
  }
  const artifact = await operations.loadOutcomeArtifact(workflowRun, options);
  assertTrustedOutcomeArtifact(artifact, workflowRun, options);

  const workDir = operations.createTemporaryDirectory();
  try {
    const artifactDir = await operations.downloadOutcomeArtifact(
      artifact,
      workDir,
    );
    await operations.verifyEvidence(artifactDir, artifact, options);

    const tag = `${RELEASE_TAG_PREFIX}${options.version}`;
    const existing = await operations.existingTagCommit(tag);
    if (existing && existing !== sha) {
      throw new Error(`tag ${tag} already exists at ${existing}, not ${sha}`);
    }

    await operations.fetchTags();
    const recordPath = path.join(workDir, 'change-record.md');
    await operations.generateChangeRecord({
      recordPath,
      sha,
      version: options.version,
    });
    const releaseArgs = [
      'release',
      'create',
      tag,
      '--target',
      sha,
      '--title',
      `@bleedingdev/modern-js-* ${options.version}`,
      '--notes-file',
      recordPath,
      '--repo',
      trustedRepository,
    ];
    if (options.dryRun) {
      console.log(
        `[dry-run] authenticated published acceptance verified for ${options.version}`,
      );
      console.log(`[dry-run] would run: gh ${releaseArgs.join(' ')}`);
      return { artifact, released: false, sha, workflowRun };
    }
    console.log(await operations.createRelease(releaseArgs));
    return { artifact, released: true, sha, workflowRun };
  } finally {
    operations.removeTemporaryDirectory(workDir);
  }
}

async function main(argv = process.argv.slice(2), operations) {
  return executeBackfill(parseArgs(argv), operations);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

export {
  assertAuthenticatedRegistryInvocation,
  assertTrustedCommitReachability,
  assertTrustedOutcomeArtifact,
  assertTrustedWorkflowRun,
  createDefaultOperations,
  downloadTrustedOutcomeArtifact,
  executeBackfill,
  loadTrustedOutcomeArtifact,
  loadTrustedWorkflowRun,
  main,
  normalizedGithubRepository,
  parseArgs,
  trustedBranch,
  trustedRef,
  trustedRemote,
  trustedRepository,
  trustedWorkflowPath,
  validateOutcomeArchiveEntries,
  verifyAuthenticatedRegistryPackage,
  verifyAuthenticatedRegistryProvenance,
  verifyBackfillEvidence,
  verifyPublishOutcomeAtSourceCommit,
};
