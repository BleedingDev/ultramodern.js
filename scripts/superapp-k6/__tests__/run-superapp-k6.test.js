const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  parseArgs,
  resolveExecutableValue,
  resolveK6Binary,
} = require('../run-superapp-k6');

const RUNNER_PATH = path.resolve(__dirname, '../run-superapp-k6.js');
const DEFAULT_SCENARIO_SCRIPT_PATH = path.resolve(
  __dirname,
  '../superapp-scenarios.js',
);

test('parseArgs keeps pass-through k6 arguments after --', () => {
  const parsed = parseArgs(
    [
      '--check',
      '--k6-bin',
      './tools/k6',
      '--base-url',
      'http://localhost:9000/',
      '--',
      '--vus',
      '4',
      '--duration',
      '30s',
    ],
    {},
  );

  assert.equal(parsed.checkOnly, true);
  assert.equal(parsed.baseUrl, 'http://localhost:9000');
  assert.equal(parsed.k6Bin, './tools/k6');
  assert.deepEqual(parsed.passThroughArgs, ['--vus', '4', '--duration', '30s']);
});

test('parseArgs maps built-in scenario selection to the default k6 script', () => {
  const parsed = parseArgs(
    ['--scenario', 'smoke,chat', '--', '--tag', 'lane=ust-load-02'],
    {},
  );

  assert.equal(parsed.scriptPath, DEFAULT_SCENARIO_SCRIPT_PATH);
  assert.equal(parsed.scenario, 'smoke,chat');
  assert.deepEqual(parsed.scenarioIds, ['smoke', 'chat']);
  assert.deepEqual(parsed.passThroughArgs, ['--tag', 'lane=ust-load-02']);
});

test('resolveExecutableValue expands home-relative paths', () => {
  assert.equal(
    resolveExecutableValue('~/bin/k6'),
    path.join(os.homedir(), 'bin/k6'),
  );
});

test('missing-k6 scenario command writes a skipped diagnostic artifact', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'superapp-k6-'));
  const missingK6 = path.join(tempDir, 'missing-k6');

  try {
    const result = spawnSync(
      process.execPath,
      [
        RUNNER_PATH,
        '--scenario',
        'smoke',
        '--k6-bin',
        missingK6,
        '--output-dir',
        tempDir,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          K6_BIN: '',
          SUPERAPP_K6_BIN: '',
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    const stdout = JSON.parse(result.stdout);
    assert.equal(stdout.status, 'skipped');
    assert.equal(stdout.scenario, 'smoke');
    assert.deepEqual(stdout.scenarioIds, ['smoke']);

    const summary = JSON.parse(
      fs.readFileSync(path.join(tempDir, 'summary.json'), 'utf8'),
    );
    assert.equal(summary.detail.runner.status, 'skipped');
    assert.equal(summary.parameters.scenario, 'smoke');
    assert.deepEqual(summary.parameters.scenarioIds, ['smoke']);
    assert.match(summary.parameters.scriptPath, /superapp-scenarios\.js$/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('resolveK6Binary reports missing explicit binary without throwing', () => {
  const resolution = resolveK6Binary(
    {
      k6Bin: '/definitely/missing/k6',
    },
    () => ({
      error: new Error('spawn ENOENT'),
      status: null,
      signal: null,
      stdout: '',
      stderr: '',
    }),
  );

  assert.equal(resolution.found, false);
  assert.equal(resolution.attempts.length, 1);
  assert.equal(resolution.attempts[0].source, 'explicit');
  assert.match(resolution.attempts[0].error, /ENOENT/);
});

test('missing-k6 smoke command writes a skipped diagnostic artifact', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'superapp-k6-'));
  const missingK6 = path.join(tempDir, 'missing-k6');

  try {
    const result = spawnSync(
      process.execPath,
      [RUNNER_PATH, '--check', '--k6-bin', missingK6, '--output-dir', tempDir],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          K6_BIN: '',
          SUPERAPP_K6_BIN: '',
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    const stdout = JSON.parse(result.stdout);
    assert.equal(stdout.status, 'skipped');
    assert.equal(stdout.artifactStatus, 'unknown');
    assert.match(stdout.diagnostic.message, /Configured k6 binary/);

    const summary = JSON.parse(
      fs.readFileSync(path.join(tempDir, 'summary.json'), 'utf8'),
    );
    assert.equal(summary.status, 'unknown');
    assert.equal(summary.detail.runner.status, 'skipped');
    assert.equal(summary.detail.runner.diagnostic.code, 'K6_NOT_AVAILABLE');
    assert.equal(summary.detail.runner.attempts[0].command, missingK6);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
