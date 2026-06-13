const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createArtifactEnvelope,
  deriveArtifactStatus,
  writeArtifactSummary,
} = require('../artifact-schema');

const makeTempDir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-schema-'));

test('createArtifactEnvelope normalizes schema fields without changing shape', () => {
  const envelope = createArtifactEnvelope({
    suite: 'sample',
    target: 'local',
    profile: 'smoke',
    startedAt: '2026-06-13T00:00:00.000Z',
    finishedAt: '2026-06-13T00:00:01.500Z',
    dimensions: ['contract', 'invalid', 'browser'],
    artifacts: ['summary.json', { path: 'detail.json' }],
    observations: 'single observation',
  });

  assert.equal(envelope.schemaVersion, 1);
  assert.equal(envelope.status, 'passed');
  assert.equal(envelope.durationMs, 1500);
  assert.deepEqual(envelope.dimensions, ['contract', 'browser']);
  assert.deepEqual(envelope.artifacts, [
    { path: 'summary.json' },
    { path: 'detail.json' },
  ]);
  assert.deepEqual(envelope.observations, ['single observation']);
});

test('deriveArtifactStatus preserves failure precedence', () => {
  assert.equal(deriveArtifactStatus({ budgetFailures: ['p95'] }), 'failed');
  assert.equal(deriveArtifactStatus({ unexpectedErrorCount: 1 }), 'failed');
  assert.equal(deriveArtifactStatus({ unknowns: ['skipped'] }), 'unknown');
  assert.equal(deriveArtifactStatus({ warnings: ['slow'] }), 'warning');
  assert.equal(deriveArtifactStatus({}), 'passed');
});

test('writeArtifactSummary uses the shared JSON writer and returns summary', () => {
  const dir = makeTempDir();
  try {
    const summary = { status: 'passed' };
    const outputPath = path.join(dir, 'nested', 'summary.json');
    assert.equal(writeArtifactSummary(outputPath, summary), summary);
    assert.equal(
      fs.readFileSync(outputPath, 'utf8'),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
