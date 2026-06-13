const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { SUPERAPP_READINESS_DIMENSIONS } = require('../../lib/artifact-schema');

const repoRoot = path.resolve(__dirname, '../../..');
const scriptPath = path.join(
  repoRoot,
  'scripts/superapp-certification/generate-readiness-report.js',
);

const makeTempDir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'superapp-readiness-'));

test('readiness report preserves artifact dimensions and warning status', () => {
  const tempDir = makeTempDir();
  try {
    const inputDir = path.join(tempDir, 'input');
    const outDir = path.join(tempDir, 'out');
    const summaryDir = path.join(inputDir, 'custom');
    fs.mkdirSync(summaryDir, { recursive: true });
    fs.writeFileSync(
      path.join(summaryDir, 'summary.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          suite: 'custom-artifact',
          status: 'warning',
          dimensions: [...SUPERAPP_READINESS_DIMENSIONS, 'not-a-dimension'],
        },
        null,
        2,
      )}\n`,
    );

    const result = spawnSync(
      process.execPath,
      [scriptPath, '--input-dir', inputDir, '--out-dir', outDir],
      {
        cwd: repoRoot,
        encoding: 'utf8',
      },
    );

    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(
      fs.readFileSync(path.join(outDir, 'latest.json'), 'utf8'),
    );
    assert.equal(report.readiness.overallStatus, 'provisional');
    assert.deepEqual(
      Object.fromEntries(
        SUPERAPP_READINESS_DIMENSIONS.map(dimension => [
          dimension,
          report.readiness.dimensions[dimension].status,
        ]),
      ),
      Object.fromEntries(
        SUPERAPP_READINESS_DIMENSIONS.map(dimension => [dimension, 'warning']),
      ),
    );
    assert.equal(report.evidence[0].status, 'warning');
    assert.deepEqual(
      report.evidence[0].dimensions,
      SUPERAPP_READINESS_DIMENSIONS,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
