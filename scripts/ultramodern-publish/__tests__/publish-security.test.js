const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '../../..');
const scriptPath = path.join(
  repoRoot,
  'scripts/ultramodern-publish/validate-publish-security.mjs',
);

const runSecurityValidation = env =>
  spawnSync(process.execPath, [scriptPath], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PUBLISH_VERSION: '3.2.0-ultramodern.1',
      PUBLISH_TAG: 'ultramodern-canary',
      PUBLISH_CONCURRENCY: '8',
      ...env,
    },
  });

test('publish security validation accepts the enforced full-cohort workflow', () => {
  const result = runSecurityValidation();

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Publish security validation passed/);
});

test('publish security validation rejects partial publish controls', () => {
  const result = runSecurityValidation({
    PACKAGE_MODE: 'explicit',
    EXPLICIT_PACKAGES: '@modern-js/create',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /partial publish controls are forbidden/);
});
