const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const {
  ENVIRONMENT_VERSION_VARIABLE,
  runMatrix,
  runScenario,
} = require('../run-version-switching-proof');

test('workspace selector proves the v1 UI and API markers move together', async () => {
  const evidence = await runScenario({
    id: 'workspace-v1',
    selector: 'workspace',
    version: 'v1',
  });

  assert.equal(evidence.status, 'pass');
  assert.equal(evidence.selectedVersion, 'v1');
  assert.equal(evidence.uiMarker, 'commerce-ui-version:v1');
  assert.equal(evidence.apiMarker, 'commerce-api-version:v1');
  assert.match(
    evidence.selectedMfManifestUrl,
    /\/commerce\/v1\/mf-manifest\.json$/,
  );
  assert.match(evidence.apiBaseUrl, /\/api\/commerce\/v1$/);
  assert.equal(evidence.zephyrDependency.dependency.selector, 'workspace:*');
  assert.equal(evidence.zephyrDependency.override, null);
});

test('latest/tag selector proves the v2 UI and API markers move together', async () => {
  const evidence = await runScenario({
    id: 'latest-tag-v2',
    selector: 'latest',
  });

  assert.equal(evidence.status, 'pass');
  assert.equal(evidence.selectedVersion, 'v2');
  assert.equal(evidence.uiMarker, 'commerce-ui-version:v2');
  assert.equal(evidence.apiMarker, 'commerce-api-version:v2');
  assert.equal(evidence.zephyrDependency.dependency.selector, '@latest');
  assert.equal(
    evidence.assertions.every(assertion => assertion.status === 'pass'),
    true,
  );
});

test('environment override records Zephyr override semantics and selects v2', async () => {
  const evidence = await runScenario(
    {
      id: 'environment-override-preview',
      selector: 'environment',
      environment: 'production',
    },
    {
      [ENVIRONMENT_VERSION_VARIABLE]: '2.0.0',
    },
  );

  assert.equal(evidence.status, 'pass');
  assert.equal(evidence.selectedVersion, 'v2');
  assert.equal(evidence.uiMarker, 'commerce-ui-version:v2');
  assert.equal(evidence.apiMarker, 'commerce-api-version:v2');
  assert.equal(evidence.zephyrDependency.dependency.selector, 'workspace:*');
  assert.deepEqual(evidence.zephyrDependency.override, {
    kind: 'environment',
    environment: 'production',
    source: 'env-var',
    selector: '@2.0.0',
    variable: ENVIRONMENT_VERSION_VARIABLE,
    semantics:
      'An environment override replaces the resolved remote dependency selector at runtime without rebuilding the host.',
  });
});

test('skewed full-stack selection fails with full-stack-version-mismatch', async () => {
  const evidence = await runScenario({
    id: 'skew-ui-v2-api-v1',
    selector: 'exact',
    version: '2.0.0',
    skew: {
      apiVersion: 'v1',
    },
  });

  assert.equal(evidence.status, 'fail');
  assert.equal(evidence.reason, 'full-stack-version-mismatch');
  assert.equal(evidence.uiMarker, 'commerce-ui-version:v2');
  assert.equal(evidence.apiMarker, 'commerce-api-version:v1');
  assert.deepEqual(
    evidence.assertions.map(assertion => [assertion.id, assertion.status]),
    [
      ['ui-marker', 'pass'],
      ['api-marker', 'fail'],
      ['full-stack-version-lockstep', 'fail'],
    ],
  );
});

test('matrix run archives passing selectors and expected skew failure', async () => {
  const evidence = await runMatrix({
    archivedAt: '2026-05-26T00:00:00.000Z',
  });

  assert.equal(evidence.status, 'pass');
  assert.equal(evidence.summary.passed, 5);
  assert.equal(evidence.summary.failed, 0);
  assert.equal(evidence.summary.expectedSkewFailures, 1);
  assert.equal(
    evidence.negativeControls[0].reason,
    'full-stack-version-mismatch',
  );
});

test('CLI writes archived machine-readable evidence when --out is provided', async () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ultramodern-version-switching-'),
  );
  const outPath = path.join(tempDir, 'evidence.json');
  const cliPath = path.join(__dirname, '..', 'run-version-switching-proof.js');

  try {
    const result = spawnSync(
      process.execPath,
      [cliPath, '--case', 'workspace-v1', '--out', outPath],
      {
        encoding: 'utf-8',
      },
    );

    assert.equal(result.status, 0, result.stderr);
    const stdoutEvidence = JSON.parse(result.stdout);
    assert.equal(stdoutEvidence.status, 'pass');
    assert.equal(stdoutEvidence.uiMarker, 'commerce-ui-version:v1');

    const evidence = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
    assert.equal(evidence.status, 'pass');
    assert.equal(evidence.uiMarker, 'commerce-ui-version:v1');
    assert.equal(evidence.apiMarker, 'commerce-api-version:v1');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
