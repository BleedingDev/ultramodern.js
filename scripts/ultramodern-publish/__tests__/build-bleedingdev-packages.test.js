const assert = require('node:assert/strict');
const test = require('node:test');

test('release builds bypass local and remote Nx caches', async () => {
  const { createReleaseBuildArgs } = await import(
    '../build-bleedingdev-packages.mjs'
  );

  assert.deepEqual(
    createReleaseBuildArgs(['@modern-js/runtime', '@modern-js/create']),
    [
      'exec',
      'nx',
      'run-many',
      '-t',
      'build',
      '-p',
      '@modern-js/runtime,@modern-js/create',
      '--maxParallel=8',
      '--skipNxCache',
      '--skipRemoteCache',
    ],
  );
});
