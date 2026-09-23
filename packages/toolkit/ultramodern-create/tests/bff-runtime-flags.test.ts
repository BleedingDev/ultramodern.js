import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const packageRoot = path.resolve(__dirname, '..');
const builtCliPath = path.join(packageRoot, 'dist/esm-node/index.js');

const runCli = (cwd: string, args: string[]) =>
  spawnSync(process.execPath, [builtCliPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: process.env,
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

    const topology = JSON.parse(
      fs.readFileSync(
        path.join(workspaceDir, 'topology/reference-topology.json'),
        'utf8',
      ),
    );
    const catalog = topology.verticals.find(
      (app: { id?: string }) => app.id === 'catalog',
    );
    assert.equal(catalog.api.runtime, 'effect');
    assert.equal(catalog.api.bff.strictEffectApproach, true);
    assert.equal(
      fs.existsSync(path.join(workspaceDir, 'verticals/catalog/api/index.ts')),
      true,
    );
  });
});

const invalidRuntimeFlagCases = [
  {
    name: 'rejects an unsupported runtime',
    project: 'bff-invalid-smoke',
    args: ['--bff-runtime', 'unknown-runtime'],
    error: /Unsupported BFF runtime "unknown-runtime"/u,
  },
  {
    name: 'requires a runtime value',
    project: 'bff-missing-smoke',
    args: ['--bff-runtime'],
    error: /--bff-runtime requires a value \(supported: effect\)/u,
  },
  {
    name: 'rejects a value for the boolean BFF flag',
    project: 'bff-value-smoke',
    args: ['--bff=hono'],
    error: /--bff does not accept a value/u,
  },
] as const;

test.each(invalidRuntimeFlagCases)('$name before writing anything', entry => {
  withTempDir(tmpDir => {
    const result = runCli(tmpDir, [entry.project, ...entry.args]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, entry.error);
    if (entry.name === 'rejects an unsupported runtime') {
      assert.match(result.stderr, /supported: effect/u);
    }
    assert.equal(
      fs.existsSync(path.join(tmpDir, entry.project)),
      false,
      'invalid flags must not leave a project directory behind',
    );
  });
});
