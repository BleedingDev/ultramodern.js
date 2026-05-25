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
    assert.equal(result.mode, 'dry-run');
    assert.equal(result.generated, true);
    assert.equal(result.doctor.status, 'pass');
    assert.equal(result.controlPlane.summary.total, 4);
    assert.equal(result.controlPlane.summary.planned, 4);
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
    assert.equal(result.controlPlane.summary.disabled, 2);
    assert.equal(
      result.controlPlane.processes.find(
        process => process.id === 'remote-commerce',
      ).readiness.status,
      'disabled-by-overlay',
    );
    assert.equal(
      result.controlPlane.processes.find(
        process => process.id === 'remote-identity',
      ).readiness.status,
      'disabled-by-overlay',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('passes package-source options through generated workspace preflight', () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ultramodern-preflight-'),
  );
  const workspace = path.join(tempRoot, 'preflight-install-workspace');
  try {
    const result = runUltramodernPreflight({
      workspace,
      overlay: 'none',
      packageSource: 'install',
      packageVersion: '3.2.0-ultramodern.0',
      packageRegistry: 'https://registry.example.test/',
      packageScope: 'bleedingdev',
      packageNamePrefix: 'modern-js-',
    });

    assert.equal(result.status, 'pass');
    assert.equal(result.generated, true);
    assert.equal(result.doctor.status, 'pass');
    const packageSource = JSON.parse(
      fs.readFileSync(
        path.join(workspace, '.modernjs/ultramodern-package-source.json'),
        'utf-8',
      ),
    );
    assert.equal(packageSource.strategy, 'install');
    assert.equal(packageSource.modernPackages.specifier, '3.2.0-ultramodern.0');
    assert.equal(
      packageSource.modernPackages.aliases['@modern-js/runtime'],
      '@bleedingdev/modern-js-runtime',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('live mode requires an existing installed workspace', () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ultramodern-preflight-'),
  );
  const workspace = path.join(tempRoot, 'preflight-live-workspace');
  try {
    const result = runUltramodernPreflight({
      workspace,
      mode: 'live',
    });

    assert.equal(result.status, 'fail');
    assert.match(result.error, /existing installed workspace/);
    assert.equal(result.steps.length, 0);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
