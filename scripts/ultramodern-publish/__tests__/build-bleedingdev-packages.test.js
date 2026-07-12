const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const scriptPath = path.resolve(__dirname, '../build-bleedingdev-packages.mjs');

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

test('unexpected CLI arguments fail before starting a release build', () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'modern-release-build-args-'),
  );

  try {
    const binDir = path.join(tempDir, 'bin');
    const buildCallLog = path.join(tempDir, 'build-calls.log');
    const fakePnpm = path.join(binDir, 'pnpm');
    fs.mkdirSync(binDir);
    fs.writeFileSync(
      fakePnpm,
      [
        '#!/bin/sh',
        'printf \'invoked\\n\' >> "$BUILD_CALL_LOG"',
        "printf '[]\\n'",
        '',
      ].join('\n'),
    );
    fs.chmodSync(fakePnpm, 0o755);

    const result = spawnSync(process.execPath, [scriptPath, '--help'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
        BUILD_CALL_LOG: buildCallLog,
      },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unexpected argument\(s\): --help/);
    assert.equal(
      fs.existsSync(buildCallLog),
      false,
      'pnpm must not be invoked',
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
