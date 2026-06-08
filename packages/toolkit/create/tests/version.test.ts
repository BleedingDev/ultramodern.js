import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const packageRoot = path.resolve(__dirname, '..');
const builtCliPath = path.join(packageRoot, 'dist/esm-node/index.js');

test('package exposes the pnpm dlx command alias', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
  );

  assert.equal(packageJson.bin['modern-js-create'], './bin/run.js');
});

test('built CLI resolves package metadata for --version', () => {
  const result = spawnSync(process.execPath, [builtCliPath, '--version'], {
    cwd: packageRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /@bleedingdev\/modern-js-create version: \d+\.\d+\.\d+/,
  );
});

test('built CLI resolves package templates for default scaffold', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modern-create-cli-'));

  try {
    const result = spawnSync(process.execPath, [builtCliPath, 'smoke-app'], {
      cwd: tmpDir,
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      fs.existsSync(
        path.join(tmpDir, 'smoke-app', '.modernjs/mv-template-manifest.json'),
      ),
      true,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('built CLI resolves package templates for workspace scaffold', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modern-create-cli-'));

  try {
    const result = spawnSync(
      process.execPath,
      [builtCliPath, 'smoke-workspace', '--ultramodern-workspace'],
      {
        cwd: tmpDir,
        encoding: 'utf8',
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      fs.existsSync(
        path.join(tmpDir, 'smoke-workspace', 'pnpm-workspace.yaml'),
      ),
      true,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
