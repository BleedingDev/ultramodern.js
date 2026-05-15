const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { runUltramodernPreflight } = require('../run-preflight');

test('generates and validates an UltraModern workspace end to end', () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ultramodern-preflight-'),
  );
  const workspace = path.join(tempRoot, 'preflight-workspace');
  try {
    const result = runUltramodernPreflight({
      workspace,
      overlay: 'none',
    });

    assert.equal(result.status, 'pass');
    assert.equal(result.generated, true);
    assert.equal(result.doctor.status, 'pass');
    assert.equal(result.controlPlane.summary.total, 5);
    assert.equal(result.controlPlane.summary.planned, 5);
    assert.deepEqual(
      result.smokeChecks.map(check => [check.id, check.status]),
      [
        ['doctor-pass', 'pass'],
        ['control-plane-process-count', 'pass'],
        ['control-plane-roles', 'pass'],
      ],
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('can produce overlay evidence without launching processes', () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ultramodern-preflight-'),
  );
  const workspace = path.join(tempRoot, 'preflight-overlay-workspace');
  try {
    const result = runUltramodernPreflight({
      workspace,
      overlay: 'service-unavailable',
    });

    assert.equal(result.status, 'fail');
    assert.equal(result.controlPlane.overlay, 'service-unavailable');
    assert.equal(result.controlPlane.summary.disabled, 1);
    assert.equal(
      result.controlPlane.processes.find(
        process => process.id === 'service-recommendations-effect',
      ).readiness.status,
      'disabled-by-overlay',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
