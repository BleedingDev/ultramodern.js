// Consumer: publish-bleedingdev.yml qualify-source and prepare-release jobs.
//
// A recovery dispatch (`recovery_run_id`) publishes bytes an earlier run
// produced, but `qualify-source` qualifies this run's own HEAD, and the
// recovered manifest only has to name an *ancestor* of it. Nothing therefore
// proved that the commit whose bytes reach the registry was ever qualified: a
// run whose qualification failed while its producer succeeded still leaves a
// recoverable bundle behind.
//
// This receipt is that proof. `qualify-source` records the exact commit it
// qualified, bound to its own run identity, and a recovery run may reuse a
// prior bundle only when that run's receipt names the manifest's own source
// commit. Once the proof is required, re-running the qualification suites in a
// recovery run would only qualify a commit nothing publishes, so the recovery
// lane skips them and the replay drops a full qualification pass.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const sourceQualificationSchema =
  'bleedingdev.ultramodern.source-qualification';
export const sourceQualificationSchemaVersion = 1;
export const sourceQualificationArtifactPrefix =
  'bleedingdev-source-qualification';

const repositoryPattern = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/u;
const commitPattern = /^[0-9a-f]{40}$/u;
const runIdPattern = /^[1-9][0-9]*$/u;

function assertPattern(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`${label} is not a valid ${label.toLowerCase()}`);
  }
  return value;
}

function runIdentityOf({ repository, runAttempt, runId }) {
  return `github:${repository}:run:${runId}:attempt:${runAttempt}`;
}

export function sourceQualificationArtifactName({ runAttempt, runId }) {
  return `${sourceQualificationArtifactPrefix}-run-${assertPattern(
    runId,
    runIdPattern,
    'Run id',
  )}-attempt-${assertPattern(runAttempt, runIdPattern, 'Run attempt')}`;
}

export function createSourceQualification({
  commit,
  outPath,
  repository,
  runAttempt,
  runId,
}) {
  const receipt = {
    schema: sourceQualificationSchema,
    schemaVersion: sourceQualificationSchemaVersion,
    source: {
      repository: assertPattern(repository, repositoryPattern, 'Repository'),
      commit: assertPattern(commit, commitPattern, 'Source commit'),
    },
    runId: assertPattern(runId, runIdPattern, 'Run id'),
    runAttempt: assertPattern(runAttempt, runIdPattern, 'Run attempt'),
    runIdentity: runIdentityOf({ repository, runAttempt, runId }),
  };
  if (typeof outPath !== 'string' || outPath.length === 0) {
    throw new Error('Receipt output path is required');
  }
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

// Fails closed on anything but a receipt this repository's run `runId`/
// `runAttempt` wrote. `expectedCommit` additionally binds it to the exact
// source commit of the bundle being recovered, so an ancestral bundle whose own
// commit was never qualified cannot be promoted.
export function verifySourceQualification({
  expectedCommit = null,
  receiptPath,
  repository,
  runAttempt,
  runId,
}) {
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  const isPlainObject = value =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  const expectedKeys = [
    'runAttempt',
    'runId',
    'runIdentity',
    'schema',
    'schemaVersion',
    'source',
  ].sort();
  if (
    !isPlainObject(receipt) ||
    JSON.stringify(Object.keys(receipt).sort()) !==
      JSON.stringify(expectedKeys) ||
    !isPlainObject(receipt.source) ||
    JSON.stringify(Object.keys(receipt.source).sort()) !==
      JSON.stringify(['commit', 'repository'])
  ) {
    throw new Error(
      'Source qualification receipt does not match the strict receipt shape',
    );
  }
  if (
    receipt.schema !== sourceQualificationSchema ||
    receipt.schemaVersion !== sourceQualificationSchemaVersion
  ) {
    throw new Error(
      `Unknown source qualification schema ${receipt.schema}@${receipt.schemaVersion}`,
    );
  }
  const expected = {
    repository: assertPattern(repository, repositoryPattern, 'Repository'),
    runId: assertPattern(runId, runIdPattern, 'Run id'),
    runAttempt: assertPattern(runAttempt, runIdPattern, 'Run attempt'),
  };
  if (
    receipt.source.repository !== expected.repository ||
    receipt.runId !== expected.runId ||
    receipt.runAttempt !== expected.runAttempt ||
    receipt.runIdentity !==
      runIdentityOf({
        repository: expected.repository,
        runAttempt: expected.runAttempt,
        runId: expected.runId,
      })
  ) {
    throw new Error(
      'Source qualification receipt was not produced by the recovered run',
    );
  }
  assertPattern(receipt.source.commit, commitPattern, 'Source commit');
  if (expectedCommit !== null) {
    if (
      assertPattern(expectedCommit, commitPattern, 'Source commit') !==
      receipt.source.commit
    ) {
      throw new Error(
        'Recovered release bundle was not qualified at its own source commit',
      );
    }
  }
  return receipt;
}

function required(values, flag) {
  const index = values.indexOf(flag);
  if (index === -1 || typeof values[index + 1] !== 'string') {
    throw new Error(`Missing ${flag}`);
  }
  return values[index + 1];
}

function optional(values, flag) {
  return values.includes(flag) ? required(values, flag) : null;
}

export function runSourceQualificationCli(argv) {
  const [command, ...values] = argv;
  if (command === 'create') {
    createSourceQualification({
      commit: required(values, '--commit'),
      outPath: required(values, '--out'),
      repository: required(values, '--repository'),
      runAttempt: required(values, '--run-attempt'),
      runId: required(values, '--run-id'),
    });
    return;
  }
  if (command === 'verify') {
    verifySourceQualification({
      expectedCommit: optional(values, '--expect-commit'),
      receiptPath: required(values, '--receipt'),
      repository: required(values, '--repository'),
      runAttempt: required(values, '--run-attempt'),
      runId: required(values, '--run-id'),
    });
    return;
  }
  throw new Error(`Unknown source qualification command ${String(command)}`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runSourceQualificationCli(process.argv.slice(2));
}
