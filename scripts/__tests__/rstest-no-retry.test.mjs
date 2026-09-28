// A retried test that passes on its second attempt reports green, so a
// flaky fixture or a race in the framework hides behind the retry. Fix the
// wait or the race instead. The word alone is rejected in rstest configs and
// setConfig objects, so no key, shorthand or comment layout slips through.
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

const mentionsRetry = text => /\bretry\b/.test(text);

// The argument text of every `setConfig(...)` call, up to its balanced `)`.
// Comments are dropped first so a parenthesis inside one cannot end a call.
function setConfigArguments(text) {
  const source = text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
  const calls = [];
  for (const match of source.matchAll(/\bsetConfig\s*\(/g)) {
    let depth = 1;
    let end = match.index + match[0].length;
    while (depth > 0 && end < source.length) {
      const char = source[end++];
      depth += char === '(' ? 1 : char === ')' ? -1 : 0;
    }
    calls.push(source.slice(match.index + match[0].length, end));
  }
  return calls;
}

test('no rstest config, setConfig call or script retries failed tests', () => {
  const offenders = [
    ...trackedFiles
      .filter(file => /(^|\/)rstest(\.[\w-]+)?\.config\.[cm]?[jt]s$/.test(file))
      .filter(file => mentionsRetry(read(file))),
    ...trackedFiles
      .filter(file => /\.(test|spec)\.[cm]?[jt]sx?$/.test(file))
      .filter(file => setConfigArguments(read(file)).some(mentionsRetry)),
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
