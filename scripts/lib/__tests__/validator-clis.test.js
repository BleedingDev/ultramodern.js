/**
 * End-to-end exit-code contracts for the gate validator CLIs that share
 * scripts/lib/validation-kit.js. Valid input must exit 0, broken input must
 * exit 1 with the validator's failure prefix on stderr.
 */
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '../../..');
const contractPath =
  'docs/super-app-rfc-adr/contracts/module-sdk-contracts.json';

const makeTempDir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'validator-cli-'));

const runCli = (cliPath, args) =>
  spawnSync(process.execPath, [path.join(repoRoot, cliPath), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

const writeJson = (dir, name, value) => {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
};

test('module-sdk-contracts CLI passes on the repo contract', () => {
  const result = runCli(
    'scripts/module-sdk-contracts/validate-module-sdk-contracts.js',
    ['--contract', contractPath, '--skip-manifest-validation'],
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[module-sdk-contracts\] validation passed/);
});

test('module-sdk-contracts CLI fails on an unsupported schemaVersion', () => {
  const dir = makeTempDir();
  try {
    const brokenContract = writeJson(dir, 'contract.json', {
      schemaVersion: 2,
    });
    const result = runCli(
      'scripts/module-sdk-contracts/validate-module-sdk-contracts.js',
      ['--contract', brokenContract, '--skip-manifest-validation'],
    );
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /\[module-sdk-contracts\] validation failed: Unsupported contract schemaVersion: 2/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('boundary-guards CLI passes on a minimal valid profile', () => {
  const dir = makeTempDir();
  try {
    const profilePath = writeJson(dir, 'profile.json', {
      schemaVersion: 1,
      contractPath,
      moduleManifests: [],
      importGuards: [],
      requiredSnippets: [],
    });
    const result = runCli('scripts/boundary-guards/check-boundary-violations.js', [
      '--profile',
      profilePath,
      '--allow-empty-manifests',
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\[boundary-guards\] anti-pattern checks passed/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('boundary-guards CLI fails on an unsupported profile schemaVersion', () => {
  const dir = makeTempDir();
  try {
    const profilePath = writeJson(dir, 'profile.json', {
      schemaVersion: 2,
      contractPath,
      moduleManifests: [],
      importGuards: [],
      requiredSnippets: [],
    });
    const result = runCli('scripts/boundary-guards/check-boundary-violations.js', [
      '--profile',
      profilePath,
      '--allow-empty-manifests',
    ]);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /Unsupported boundary guard profile schemaVersion: 2/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('release-gates CLI passes on module certification evidence', () => {
  const dir = makeTempDir();
  try {
    const result = runCli(
      'scripts/release-gates/validate-release-candidate-gates.js',
      [
        '--profile',
        'scripts/release-gates/module-certification-profile.json',
        '--evidence-dir',
        'docs/super-app-rfc-adr/evidence/module-certification/current',
        '--skip-commands',
        '--gate-snapshot-path',
        path.join(dir, 'gates.json'),
      ],
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\[release-gates\] RC contract gates passed/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('release-gates CLI fails when evidence files are missing', () => {
  const dir = makeTempDir();
  try {
    const result = runCli(
      'scripts/release-gates/validate-release-candidate-gates.js',
      [
        '--profile',
        'scripts/release-gates/module-certification-profile.json',
        '--evidence-dir',
        path.join(dir, 'empty-evidence'),
        '--skip-commands',
        '--gate-snapshot-path',
        path.join(dir, 'gates.json'),
      ],
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Missing required evidence file/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('release-gates snapshot CLI validates a well-formed snapshot', () => {
  const dir = makeTempDir();
  try {
    const snapshotPath = writeJson(dir, 'gates.json', {
      schemaVersion: 1,
      updatedAt: Date.now(),
      gates: {
        'sample-gate': { passed: true, updatedAt: Date.now() },
      },
    });
    const valid = runCli('scripts/release-gates/validate-gate-snapshot.js', [
      '--snapshot-path',
      snapshotPath,
      '--required-gate',
      'sample-gate',
    ]);
    assert.equal(valid.status, 0, valid.stderr);

    const missingGate = runCli(
      'scripts/release-gates/validate-gate-snapshot.js',
      ['--snapshot-path', snapshotPath, '--required-gate', 'absent-gate'],
    );
    assert.equal(missingGate.status, 1);
    assert.match(missingGate.stderr, /missing required gate "absent-gate"/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
