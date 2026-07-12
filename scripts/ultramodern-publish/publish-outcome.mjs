#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const publishOutcomeSchema = 'bleedingdev.ultramodern.publish-outcome';
const publishOutcomeSchemaVersion = 1;
const publishOutcomeArtifactPrefix = 'bleedingdev-publish-outcome';
const digestPattern = /^[a-f0-9]{64}$/u;
const commitPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

function assertPlainObject(value, label) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new Error(`${label} must be a JSON object`);
  }
}

function assertExactKeys(value, expected, label) {
  assertPlainObject(value, label);
  const actual = Object.keys(value).sort((left, right) =>
    left.localeCompare(right),
  );
  const sortedExpected = [...expected].sort((left, right) =>
    left.localeCompare(right),
  );
  if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
    throw new Error(
      `${label} has unknown or missing fields: expected ${sortedExpected.join(
        ', ',
      )}; found ${actual.join(', ')}`,
    );
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value === '' || value.trim() !== value) {
    throw new Error(`${label} must be a non-empty trimmed string`);
  }
  if (/\r|\n/u.test(value)) {
    throw new Error(`${label} must not contain line breaks`);
  }
}

function positiveInteger(value, label) {
  const normalized =
    typeof value === 'string' && /^[1-9]\d*$/u.test(value)
      ? Number(value)
      : value;
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return normalized;
}

function runIdString(value, label = 'workflow run id') {
  const normalized = String(value);
  if (!/^[1-9]\d*$/u.test(normalized)) {
    throw new Error(`${label} must be a positive decimal integer`);
  }
  return normalized;
}

function assertDigest(value, label) {
  if (typeof value !== 'string' || !digestPattern.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
}

function readJson(filePath, label) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(
      `${label} must contain valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return parsed;
}

function sha256File(filePath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

function publishOutcomeArtifactName({ runId, runAttempt }) {
  return `${publishOutcomeArtifactPrefix}-run-${runIdString(
    runId,
  )}-attempt-${positiveInteger(runAttempt, 'workflow run attempt')}`;
}

function assertRepository(value, label) {
  assertNonEmptyString(value, label);
  if (!/^[^/\s]+\/[^/\s]+$/u.test(value)) {
    throw new Error(`${label} must be an owner/repository identity`);
  }
}

function assertSourceCommit(value, label) {
  if (typeof value !== 'string' || !commitPattern.test(value)) {
    throw new Error(`${label} must be a full lowercase Git object id`);
  }
}

function assertVersion(value, label) {
  if (typeof value !== 'string' || !semverPattern.test(value)) {
    throw new Error(`${label} must be an exact semantic version`);
  }
}

function readReleaseEvidence({
  cohortDigestPath,
  manifestDigestPath,
  manifestPath,
  receiptPath,
  repository,
  sourceCommit,
  tag,
  version,
}) {
  const manifest = readJson(manifestPath, 'Release manifest');
  assertExactKeys(
    manifest,
    [
      'aliases',
      'cohortDigest',
      'cohortProjection',
      'dependencyGraph',
      'packages',
      'publishOrder',
      'release',
      'schema',
      'schemaVersion',
      'source',
      'tools',
    ],
    'Release manifest',
  );
  assertExactKeys(manifest.source, ['commit', 'repository'], 'Release source');
  assertExactKeys(manifest.release, ['tag', 'version'], 'Release identity');
  if (
    manifest.schema !== 'bleedingdev.ultramodern.release-manifest' ||
    manifest.schemaVersion !== 2 ||
    !Array.isArray(manifest.packages) ||
    manifest.packages.length === 0 ||
    !Array.isArray(manifest.publishOrder)
  ) {
    throw new Error('Release manifest must use the strict v2 release schema');
  }
  assertRepository(manifest.source.repository, 'Release source repository');
  assertSourceCommit(manifest.source.commit, 'Release source commit');
  assertVersion(manifest.release.version, 'Release version');
  assertNonEmptyString(manifest.release.tag, 'Release tag');
  assertDigest(manifest.cohortDigest, 'Release cohort digest');
  if (
    manifest.source.repository !== repository ||
    manifest.source.commit !== sourceCommit ||
    manifest.release.version !== version ||
    manifest.release.tag !== tag
  ) {
    throw new Error(
      'Release manifest does not match the expected source and version',
    );
  }

  const manifestSha256 = sha256File(manifestPath);
  const detachedManifest = fs.readFileSync(manifestDigestPath, 'utf8');
  const detachedCohort = fs.readFileSync(cohortDigestPath, 'utf8');
  if (detachedManifest !== `${manifestSha256}  manifest.json\n`) {
    throw new Error('Detached release manifest digest is invalid');
  }
  if (detachedCohort !== `${manifest.cohortDigest}\n`) {
    throw new Error('Detached release cohort digest is invalid');
  }
  assertPlainObject(
    readJson(receiptPath, 'Acceptance receipt'),
    'Acceptance receipt',
  );

  return {
    acceptanceReceiptSha256: sha256File(receiptPath),
    cohortDigest: manifest.cohortDigest,
    manifestSha256,
  };
}

function expectedProducerIdentity({ repository, runAttempt, runId }) {
  return `github:${repository}:run:${runIdString(runId)}:attempt:${positiveInteger(
    runAttempt,
    'producer run attempt',
  )}`;
}

function validateProducer({
  artifactIdentity,
  publicationRunAttempt,
  repository,
  runAttempt,
  runId,
  runIdentity,
}) {
  const normalizedAttempt = positiveInteger(runAttempt, 'Producer run attempt');
  const normalizedPublicationAttempt = positiveInteger(
    publicationRunAttempt,
    'Publication run attempt',
  );
  const normalizedRunId = runIdString(runId);
  if (normalizedAttempt > normalizedPublicationAttempt) {
    throw new Error(
      'Producer run attempt must not follow publication run attempt',
    );
  }
  if (
    artifactIdentity !== `run-${normalizedRunId}-attempt-${normalizedAttempt}`
  ) {
    throw new Error(
      'Producer artifact identity does not match the producer run',
    );
  }
  if (
    runIdentity !==
    expectedProducerIdentity({
      repository,
      runAttempt: normalizedAttempt,
      runId: normalizedRunId,
    })
  ) {
    throw new Error(
      'Producer run identity does not match the authenticated source run',
    );
  }
  return normalizedAttempt;
}

function createPublishOutcome({
  artifactName,
  cohortDigestPath,
  dryRun,
  manifestDigestPath,
  manifestPath,
  outPath,
  producerArtifactIdentity,
  producerRunAttempt,
  producerRunIdentity,
  receiptPath,
  repository,
  runAttempt,
  runId,
  sourceCommit,
  tag,
  version,
}) {
  assertRepository(repository, 'Expected repository');
  assertSourceCommit(sourceCommit, 'Expected source commit');
  assertVersion(version, 'Expected release version');
  assertNonEmptyString(tag, 'Expected release tag');
  if (typeof dryRun !== 'boolean') {
    throw new Error('dryRun must be a boolean');
  }
  const normalizedRunId = runIdString(runId);
  const normalizedRunAttempt = positiveInteger(
    runAttempt,
    'Workflow run attempt',
  );
  const expectedArtifactName = publishOutcomeArtifactName({
    runId: normalizedRunId,
    runAttempt: normalizedRunAttempt,
  });
  if (artifactName !== undefined && artifactName !== expectedArtifactName) {
    throw new Error(
      'Publish outcome artifact name does not match the workflow run',
    );
  }
  const normalizedProducerAttempt = validateProducer({
    artifactIdentity: producerArtifactIdentity,
    publicationRunAttempt: normalizedRunAttempt,
    repository,
    runAttempt: producerRunAttempt,
    runId: normalizedRunId,
    runIdentity: producerRunIdentity,
  });
  const evidence = readReleaseEvidence({
    cohortDigestPath,
    manifestDigestPath,
    manifestPath,
    receiptPath,
    repository,
    sourceCommit,
    tag,
    version,
  });
  const outcome = {
    schema: publishOutcomeSchema,
    schemaVersion: publishOutcomeSchemaVersion,
    artifactName: expectedArtifactName,
    dryRun,
    source: { commit: sourceCommit, repository },
    release: { tag, version },
    workflowRun: { attempt: normalizedRunAttempt, id: normalizedRunId },
    producer: {
      artifactIdentity: producerArtifactIdentity,
      runAttempt: normalizedProducerAttempt,
      runIdentity: producerRunIdentity,
    },
    evidence,
  };
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(outcome, null, 2)}\n`);
  return outcome;
}

function assertPublishOutcome(
  outcome,
  {
    artifactName,
    cohortDigestPath,
    manifestDigestPath,
    manifestPath,
    receiptPath,
    repository,
    runAttempt,
    runId,
    sourceCommit,
  },
) {
  assertExactKeys(
    outcome,
    [
      'artifactName',
      'dryRun',
      'evidence',
      'producer',
      'release',
      'schema',
      'schemaVersion',
      'source',
      'workflowRun',
    ],
    'Publish outcome',
  );
  assertExactKeys(
    outcome.source,
    ['commit', 'repository'],
    'Publish outcome source',
  );
  assertExactKeys(
    outcome.release,
    ['tag', 'version'],
    'Publish outcome release',
  );
  assertExactKeys(
    outcome.workflowRun,
    ['attempt', 'id'],
    'Publish outcome workflow run',
  );
  assertExactKeys(
    outcome.producer,
    ['artifactIdentity', 'runAttempt', 'runIdentity'],
    'Publish outcome producer',
  );
  assertExactKeys(
    outcome.evidence,
    ['acceptanceReceiptSha256', 'cohortDigest', 'manifestSha256'],
    'Publish outcome evidence',
  );
  if (
    outcome.schema !== publishOutcomeSchema ||
    outcome.schemaVersion !== publishOutcomeSchemaVersion
  ) {
    throw new Error(
      `Unknown publish outcome schema ${String(outcome.schema)}@${String(
        outcome.schemaVersion,
      )}`,
    );
  }
  if (typeof outcome.dryRun !== 'boolean') {
    throw new Error('Publish outcome dryRun must be a boolean');
  }
  assertRepository(outcome.source.repository, 'Publish outcome repository');
  assertSourceCommit(outcome.source.commit, 'Publish outcome source commit');
  assertVersion(outcome.release.version, 'Publish outcome release version');
  assertNonEmptyString(outcome.release.tag, 'Publish outcome release tag');
  const normalizedRunId = runIdString(runId);
  const normalizedRunAttempt = positiveInteger(
    runAttempt,
    'Expected run attempt',
  );
  const expectedArtifactName = publishOutcomeArtifactName({
    runId: normalizedRunId,
    runAttempt: normalizedRunAttempt,
  });
  if (
    artifactName !== expectedArtifactName ||
    outcome.artifactName !== expectedArtifactName ||
    outcome.workflowRun.id !== normalizedRunId ||
    outcome.workflowRun.attempt !== normalizedRunAttempt ||
    outcome.source.repository !== repository ||
    outcome.source.commit !== sourceCommit
  ) {
    throw new Error(
      'Publish outcome does not match the triggering workflow run',
    );
  }
  validateProducer({
    artifactIdentity: outcome.producer.artifactIdentity,
    publicationRunAttempt: normalizedRunAttempt,
    repository,
    runAttempt: outcome.producer.runAttempt,
    runId: normalizedRunId,
    runIdentity: outcome.producer.runIdentity,
  });
  for (const [field, value] of Object.entries(outcome.evidence)) {
    assertDigest(value, `Publish outcome evidence.${field}`);
  }
  const actualEvidence = readReleaseEvidence({
    cohortDigestPath,
    manifestDigestPath,
    manifestPath,
    receiptPath,
    repository: outcome.source.repository,
    sourceCommit: outcome.source.commit,
    tag: outcome.release.tag,
    version: outcome.release.version,
  });
  if (!isDeepStrictEqual(actualEvidence, outcome.evidence)) {
    throw new Error(
      'Publish outcome evidence digests do not match the artifact payload',
    );
  }
  return outcome;
}

function parseTimestamp(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
  return Date.parse(value);
}

function selectPublishOutcomeArtifact(
  pages,
  { completedAt, runAttempt, runId },
) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error('Artifact API response must contain at least one page');
  }
  const normalizedRunId = runIdString(runId);
  const normalizedRunAttempt = positiveInteger(
    runAttempt,
    'Workflow run attempt',
  );
  const expectedName = publishOutcomeArtifactName({
    runId: normalizedRunId,
    runAttempt: normalizedRunAttempt,
  });
  const completedAtMilliseconds = parseTimestamp(
    completedAt,
    'Trigger completion time',
  );
  const seenIds = new Set();
  const outcomeArtifacts = [];
  for (const [pageIndex, page] of pages.entries()) {
    assertPlainObject(page, `Artifact API page ${pageIndex + 1}`);
    if (!Array.isArray(page.artifacts)) {
      throw new Error(
        `Artifact API page ${pageIndex + 1}.artifacts must be an array`,
      );
    }
    for (const [artifactIndex, artifact] of page.artifacts.entries()) {
      const label = `Artifact API page ${pageIndex + 1} artifact ${artifactIndex + 1}`;
      assertPlainObject(artifact, label);
      positiveInteger(artifact.id, `${label}.id`);
      assertNonEmptyString(artifact.name, `${label}.name`);
      if (typeof artifact.expired !== 'boolean') {
        throw new Error(`${label}.expired must be a boolean`);
      }
      parseTimestamp(artifact.created_at, `${label}.created_at`);
      if (seenIds.has(artifact.id)) {
        throw new Error(
          `Artifact API repeated artifact id ${artifact.id} across pages`,
        );
      }
      seenIds.add(artifact.id);
      if (artifact.name.startsWith(publishOutcomeArtifactPrefix)) {
        outcomeArtifacts.push(artifact);
      }
    }
  }

  const canonicalPattern = new RegExp(
    `^${publishOutcomeArtifactPrefix}-run-([1-9]\\d*)-attempt-([1-9]\\d*)$`,
    'u',
  );
  for (const artifact of outcomeArtifacts) {
    const match = canonicalPattern.exec(artifact.name);
    if (
      !match ||
      match[1] !== normalizedRunId ||
      Number(match[2]) > normalizedRunAttempt
    ) {
      throw new Error(`Publish outcome artifact name drift: ${artifact.name}`);
    }
  }
  const matches = outcomeArtifacts.filter(
    artifact => artifact.name === expectedName,
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one publish outcome artifact named ${expectedName}, found ${matches.length}`,
    );
  }
  const [artifact] = matches;
  if (artifact.expired) {
    throw new Error(`Publish outcome artifact ${expectedName} is expired`);
  }
  if (Date.parse(artifact.created_at) > completedAtMilliseconds) {
    throw new Error(
      `Publish outcome artifact ${expectedName} was created after the triggering run completed`,
    );
  }
  return artifact;
}

function parseOptions(argv, allowed) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(name) || value === undefined || value.startsWith('--')) {
      throw new Error(`Unknown or incomplete argument: ${name ?? '<missing>'}`);
    }
    if (values.has(name)) {
      throw new Error(`Duplicate argument: ${name}`);
    }
    values.set(name, value);
  }
  return values;
}

function required(values, name) {
  const value = values.get(name);
  if (value === undefined) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function booleanValue(value, label) {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  throw new Error(`${label} must be true or false`);
}

function appendGithubOutputs(filePath, outputs) {
  if (!filePath) {
    return;
  }
  const lines = Object.entries(outputs).map(([name, value]) => {
    const normalized = String(value);
    assertNonEmptyString(normalized, `GitHub output ${name}`);
    return `${name}=${normalized}`;
  });
  fs.appendFileSync(filePath, `${lines.join('\n')}\n`);
}

const evidenceOptions = new Set([
  '--cohort-digest',
  '--manifest',
  '--manifest-digest',
  '--receipt',
]);

function evidencePaths(values) {
  return {
    cohortDigestPath: path.resolve(required(values, '--cohort-digest')),
    manifestDigestPath: path.resolve(required(values, '--manifest-digest')),
    manifestPath: path.resolve(required(values, '--manifest')),
    receiptPath: path.resolve(required(values, '--receipt')),
  };
}

async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  if (command === 'create') {
    const values = parseOptions(
      args,
      new Set([
        ...evidenceOptions,
        '--artifact-name',
        '--dry-run',
        '--github-output',
        '--out',
        '--producer-artifact-identity',
        '--producer-run-attempt',
        '--producer-run-identity',
        '--repository',
        '--run-attempt',
        '--run-id',
        '--source-commit',
        '--tag',
        '--version',
      ]),
    );
    const outcome = createPublishOutcome({
      ...evidencePaths(values),
      artifactName: values.get('--artifact-name'),
      dryRun: booleanValue(required(values, '--dry-run'), '--dry-run'),
      outPath: path.resolve(required(values, '--out')),
      producerArtifactIdentity: required(
        values,
        '--producer-artifact-identity',
      ),
      producerRunAttempt: required(values, '--producer-run-attempt'),
      producerRunIdentity: required(values, '--producer-run-identity'),
      repository: required(values, '--repository'),
      runAttempt: required(values, '--run-attempt'),
      runId: required(values, '--run-id'),
      sourceCommit: required(values, '--source-commit'),
      tag: required(values, '--tag'),
      version: required(values, '--version'),
    });
    appendGithubOutputs(values.get('--github-output'), {
      artifact_name: outcome.artifactName,
    });
    return 0;
  }
  if (command === 'select-artifact') {
    const values = parseOptions(
      args,
      new Set([
        '--artifacts',
        '--completed-at',
        '--github-output',
        '--run-attempt',
        '--run-id',
      ]),
    );
    const artifact = selectPublishOutcomeArtifact(
      readJson(
        path.resolve(required(values, '--artifacts')),
        'Artifact API response',
      ),
      {
        completedAt: required(values, '--completed-at'),
        runAttempt: required(values, '--run-attempt'),
        runId: required(values, '--run-id'),
      },
    );
    appendGithubOutputs(values.get('--github-output'), {
      artifact_name: artifact.name,
    });
    return 0;
  }
  if (command === 'verify') {
    const values = parseOptions(
      args,
      new Set([
        ...evidenceOptions,
        '--artifact-name',
        '--github-output',
        '--outcome',
        '--repository',
        '--run-attempt',
        '--run-id',
        '--source-commit',
      ]),
    );
    const outcome = assertPublishOutcome(
      readJson(path.resolve(required(values, '--outcome')), 'Publish outcome'),
      {
        ...evidencePaths(values),
        artifactName: required(values, '--artifact-name'),
        repository: required(values, '--repository'),
        runAttempt: required(values, '--run-attempt'),
        runId: required(values, '--run-id'),
        sourceCommit: required(values, '--source-commit'),
      },
    );
    appendGithubOutputs(values.get('--github-output'), {
      artifact_name: outcome.artifactName,
      authorized: 'true',
      dry_run: String(outcome.dryRun),
      manifest_sha256: outcome.evidence.manifestSha256,
      producer_artifact_identity: outcome.producer.artifactIdentity,
      producer_run_identity: outcome.producer.runIdentity,
      version: outcome.release.version,
    });
    return 0;
  }
  throw new Error('Command must be create, select-artifact, or verify');
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
  assertPublishOutcome,
  createPublishOutcome,
  main,
  publishOutcomeArtifactName,
  publishOutcomeArtifactPrefix,
  publishOutcomeSchema,
  publishOutcomeSchemaVersion,
  selectPublishOutcomeArtifact,
};
