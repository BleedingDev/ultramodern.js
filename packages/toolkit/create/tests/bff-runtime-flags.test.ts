import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const packageRoot = path.resolve(__dirname, '..');
const builtCliPath = path.join(packageRoot, 'dist/esm-node/index.js');

// Keeps every spawned CLI hermetic: no test may dial the npm registry for
// the @bleedingdev/modern-js-create framework cohort.
const hermeticEnv = {
  ...process.env,
  MODERN_CREATE_ULTRAMODERN_FRAMEWORK_VERSION: '3.2.0-ultramodern.108',
};

const runCli = (cwd: string, args: string[]) =>
  spawnSync(process.execPath, [builtCliPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: hermeticEnv,
  });

const withTempDir = (fn: (tmpDir: string) => void) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modern-create-bff-'));
  try {
    fn(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
};

test('--bff keeps the default strict Effect approach workspace scaffold', () => {
  withTempDir(tmpDir => {
    const createResult = runCli(tmpDir, ['bff-default-smoke', '--bff']);
    assert.equal(createResult.status, 0, createResult.stderr);

    const workspaceDir = path.join(tmpDir, 'bff-default-smoke');
    const verticalResult = runCli(workspaceDir, ['catalog', '--vertical']);
    assert.equal(verticalResult.status, 0, verticalResult.stderr);

    const workspaceContract = JSON.parse(
      fs.readFileSync(
        path.join(workspaceDir, '.modernjs/ultramodern.json'),
        'utf8',
      ),
    );
    const catalog = workspaceContract.topology.apps.find(
      (app: { id?: string }) => app.id === 'catalog',
    );
    assert.equal(catalog.api.runtime, 'effect');
    assert.equal(
      fs.existsSync(path.join(workspaceDir, 'verticals/catalog/api/index.ts')),
      true,
    );
  });
});

test('--bff-runtime effect selects the default Effect runtime explicitly', () => {
  withTempDir(tmpDir => {
    const createResult = runCli(tmpDir, [
      'bff-effect-smoke',
      '--bff-runtime',
      'effect',
    ]);
    assert.equal(createResult.status, 0, createResult.stderr);

    const workspaceDir = path.join(tmpDir, 'bff-effect-smoke');
    const verticalResult = runCli(workspaceDir, [
      'catalog',
      '--vertical',
      '--bff-runtime',
      'effect',
    ]);
    assert.equal(verticalResult.status, 0, verticalResult.stderr);
    assert.equal(
      fs.existsSync(path.join(workspaceDir, 'verticals/catalog/shared/api.ts')),
      true,
    );
  });
});

test('--bff-runtime rejects unsupported runtimes before writing anything', () => {
  withTempDir(tmpDir => {
    for (const runtime of ['hono', 'unknown-runtime']) {
      const result = runCli(tmpDir, [
        'bff-invalid-smoke',
        '--bff-runtime',
        runtime,
      ]);
      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        new RegExp(`Unsupported BFF runtime "${runtime}"`, 'u'),
      );
      assert.match(result.stderr, /supported: effect/);
      assert.equal(
        fs.existsSync(path.join(tmpDir, 'bff-invalid-smoke')),
        false,
        'an unsupported runtime must not leave a project directory behind',
      );
    }
  });
});

test('--bff-runtime= form is parsed and validated', () => {
  withTempDir(tmpDir => {
    const result = runCli(tmpDir, [
      'bff-equals-smoke',
      '--bff-runtime=unknown-runtime',
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsupported BFF runtime "unknown-runtime"/);
    assert.equal(fs.existsSync(path.join(tmpDir, 'bff-equals-smoke')), false);
  });
});

test('--bff-runtime requires a value', () => {
  withTempDir(tmpDir => {
    const result = runCli(tmpDir, ['bff-missing-smoke', '--bff-runtime']);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /--bff-runtime requires a value \(supported: effect\)/,
    );
    assert.equal(fs.existsSync(path.join(tmpDir, 'bff-missing-smoke')), false);
  });
});

test('--bff does not accept a value', () => {
  withTempDir(tmpDir => {
    const result = runCli(tmpDir, ['bff-value-smoke', '--bff=hono']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--bff does not accept a value/);
    assert.equal(fs.existsSync(path.join(tmpDir, 'bff-value-smoke')), false);
  });
});

test('--help documents the BFF flag surface', () => {
  withTempDir(tmpDir => {
    const result = runCli(tmpDir, ['--help']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--bff /);
    assert.match(result.stdout, /--bff-runtime /);
    assert.match(result.stdout, /supported: effect/);
  });
});
