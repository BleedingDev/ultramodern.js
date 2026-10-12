import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const { scripts } = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url)),
);

function routedTests(name) {
  return scripts[name]
    .split(/\s+/u)
    .filter(
      argument =>
        argument.endsWith('.test.js') || argument.endsWith('.test.mjs'),
    )
    .flatMap(pattern => globSync(pattern, { cwd: root }));
}

test('publication suites run once in the release stage that provides their dependencies', () => {
  const beforeBuild = routedTests('test:publish-tooling');
  const afterBuild = routedTests('test:scripts:after-build');
  const allScripts = routedTests('test:scripts');
  const suites = globSync(
    [
      'scripts/lib/__tests__/**/*.test.js',
      'scripts/ultramodern-publish/__tests__/**/*.test.js',
      'scripts/ultramodern-publish/__tests__/**/*.test.mjs',
      'scripts/ultramodern-production-readiness/__tests__/**/*.test.js',
    ],
    { cwd: root },
  );

  for (const suite of suites) {
    const expectedStage = suite.includes('/built-framework/')
      ? afterBuild
      : beforeBuild;
    const otherStage = suite.includes('/built-framework/')
      ? beforeBuild
      : afterBuild;
    assert.equal(expectedStage.filter(file => file === suite).length, 1, suite);
    assert.equal(otherStage.filter(file => file === suite).length, 0, suite);
    assert.equal(allScripts.filter(file => file === suite).length, 1, suite);
  }
});
