// A script that ends in `|| echo ...` exits 0 whatever it ran, and a skipped
// integration test (or an `.only` that disables its siblings) reports green
// without running. Both hide the failure they
// were added to get past, so a red build or a broken flow looks healthy.
// Fix the cause instead: make the command pass, or delete it.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

function trackedFiles(...pathspecs) {
  return execFileSync('git', ['ls-files', '-z', '--', ...pathspecs], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);
}

// The branch after `||` is a command that always succeeds: a message
// (`echo`, `printf`), a no-op (`true`, `:`) or an explicit `exit 0`.
const maskedExit =
  /\|\|\s*(?:echo\b|printf\b|true\b|exit\s+0\b|:\s*(?:$|[;&|]))/u;
// `node -e "a || true"` passes `||` to Node, not to the shell.
const quotedArgument = /'[^']*'|"(?:\\.|[^"\\])*"/gu;
// Anchored at the start of a line: a skipped test is a statement there, while
// comments and prose that mention `test.skip(` start with `//`, `*` or text.
// Modifiers may come first (`test.concurrent.skip`), a chain may break across
// lines, and `\b` rather than `\(` catches `test.skip.each(table)(...)`;
// `skipIf` has no boundary after `skip`, so it passes unless its condition is
// a literal that skips every run (`skipIf(true)`, `runIf(false)`). Rstest has
// no `xit`/`xdescribe` aliases.
const skippedTest =
  /^[ \t]*(?:(?:test|it|describe)(?:\s*\.\s*\w+)*?\s*\.\s*(?:(?:skip|todo|only)\b|skipIf\s*\(\s*true\s*\)|runIf\s*\(\s*false\s*\)))/gmu;

test('no package.json script swallows a failing exit code', () => {
  const offenders = trackedFiles('package.json', '**/package.json').flatMap(
    file => {
      const { scripts = {} } = JSON.parse(
        fs.readFileSync(path.join(repoRoot, file), 'utf8'),
      );
      return Object.entries(scripts)
        .filter(([, command]) =>
          maskedExit.test(command.replace(quotedArgument, '""')),
        )
        .map(([name, command]) => `${file} scripts.${name}: ${command}`);
    },
  );

  assert.deepEqual(
    offenders,
    [],
    'These scripts turn a failure into success. Delete the fallback and fix the command, or delete the script.',
  );
});

test('no integration test is skipped or focused unconditionally', () => {
  const offenders = trackedFiles('tests/integration').flatMap(file => {
    if (!/\.[cm]?[jt]sx?$/u.test(file)) {
      return [];
    }
    const source = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    return [...source.matchAll(skippedTest)].map(({ 0: match, index }) => {
      const line = source.slice(0, index).split('\n').length;
      return `${file}:${line}: ${match.trim().replace(/\s+/gu, '')}`;
    });
  });

  assert.deepEqual(
    offenders,
    [],
    'These tests (or their siblings, for .only) report green without running. Fix the flake (wait for the state it depends on) or delete the test; use skipIf only for a real platform condition.',
  );
});
