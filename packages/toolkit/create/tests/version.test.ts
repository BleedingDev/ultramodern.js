import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

test('built CLI resolves package metadata for --version', () => {
  const packageRoot = path.resolve(__dirname, '..');
  const result = spawnSync(
    process.execPath,
    [path.join(packageRoot, 'dist/esm-node/index.js'), '--version'],
    {
      cwd: packageRoot,
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /@bleedingdev\/modern-js-create version: \d+\.\d+\.\d+/,
  );
});
