import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

// `pnpm install` runs the root `prepare` lifecycle. It must only install the
// git hooks; building the framework is the explicit `pnpm prepare-build:local`.
test('root prepare installs git hooks without starting an nx build', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'root-prepare-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const { scripts } = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
  );
  fs.writeFileSync(
    path.join(tmp, 'package.json'),
    JSON.stringify({ name: 'root-prepare-fixture', private: true, scripts }),
  );
  fs.cpSync(path.join(repoRoot, '.husky'), path.join(tmp, '.husky'), {
    recursive: true,
  });
  assert.equal(
    spawnSync('git', ['init', '-q'], { cwd: tmp }).status,
    0,
    'git init failed',
  );

  const fakeBin = path.join(tmp, 'fake-bin');
  const nxMarker = path.join(tmp, 'nx-was-spawned');
  fs.mkdirSync(fakeBin);
  fs.writeFileSync(
    path.join(fakeBin, 'nx'),
    `#!/bin/sh\ntouch '${nxMarker}'\nexit 1\n`,
    { mode: 0o755 },
  );

  const env = { ...process.env };
  delete env.HUSKY;
  env.PATH = [
    fakeBin,
    path.join(repoRoot, 'node_modules/.bin'),
    process.env.PATH,
  ].join(path.delimiter);

  const result = spawnSync(scripts.prepare, {
    cwd: tmp,
    env,
    shell: true,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.ok(
    fs.existsSync(path.join(tmp, '.husky/_/pre-commit')),
    'prepare must install the husky pre-commit hook',
  );
  assert.equal(
    fs.existsSync(nxMarker),
    false,
    'prepare must not spawn nx; run `pnpm prepare-build:local` explicitly',
  );
});
