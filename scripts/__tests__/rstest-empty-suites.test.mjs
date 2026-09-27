import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// The shared preset sets passWithNoTests:false so a broken include glob or a
// package whose tests were deleted fails instead of reporting green.

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const rstestBin = path.join(repoRoot, 'node_modules/.bin/rstest');

const trackedFiles = execFileSync('git', ['ls-files'], {
  cwd: repoRoot,
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean);

test('no workspace script passes --passWithNoTests', () => {
  const offenders = trackedFiles
    .filter(file => path.basename(file) === 'package.json')
    .flatMap(file => {
      const { scripts = {} } = JSON.parse(
        readFileSync(path.join(repoRoot, file), 'utf8'),
      );
      return Object.entries(scripts)
        .filter(([, command]) => command.includes('passWithNoTests'))
        .map(([name]) => `${file} scripts.${name}`);
    });
  assert.deepEqual(
    offenders,
    [],
    'Delete --passWithNoTests; delete the test script and rstest config of a package that has no tests.',
  );
});

test('every rstest config matches at least one test file', () => {
  // The adapter fixture configs, and the tests aggregate that loads them as
  // projects, import the built @modern-js/adapter-rstest, which clean script
  // lanes do not build; the adapter integration run executes them instead.
  const configs = trackedFiles.filter(
    file =>
      /(^|\/)rstest(\.[\w-]+)?\.config\.m?[jt]s$/.test(file) &&
      !file.startsWith('tests/integration/') &&
      file !== 'tests/rstest.adapter.config.mts',
  );
  assert.ok(configs.length > 0);
  const empty = configs.filter(config => {
    const result = spawnSync(
      rstestBin,
      ['list', '--filesOnly', '-c', path.basename(config)],
      { cwd: path.join(repoRoot, path.dirname(config)), encoding: 'utf8' },
    );
    assert.equal(result.status, 0, `${config}: ${result.stderr}`);
    return result.stdout.trim() === '';
  });
  assert.deepEqual(
    empty,
    [],
    'These rstest configs match no test files. Fix the include glob, or delete the config and the package test script.',
  );
});
