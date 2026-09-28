// A retried test that passes on its second attempt reports green, so a
// flaky fixture or a race in the framework hides behind the retry. Fix the
// wait or the race instead.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

const trackedFiles = execFileSync('git', ['ls-files', '-z'], {
  cwd: repoRoot,
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean);

const read = file => readFileSync(path.join(repoRoot, file), 'utf8');

test('no rstest config, setConfig call or script retries failed tests', () => {
  const offenders = [
    ...trackedFiles
      .filter(file => /(^|\/)rstest(\.[\w-]+)?\.config\.m?[jt]s$/.test(file))
      .filter(file => /[{,]\s*retry\s*:/.test(read(file))),
    ...trackedFiles
      .filter(file => /\.(test|spec)\.m?[jt]sx?$/.test(file))
      .filter(file => /setConfig\(\{[^}]*\bretry\s*:/s.test(read(file))),
    ...trackedFiles
      .filter(file => path.basename(file) === 'package.json')
      .flatMap(file =>
        Object.entries(JSON.parse(read(file)).scripts ?? {})
          .filter(([, command]) => /\brstest\b.*--retry\b/.test(command))
          .map(([name]) => `${file} scripts.${name}`),
      ),
  ];
  assert.deepEqual(offenders, [], 'Delete the retry and fix the flake.');
});
