import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import tsgoInvocation from '../lib/tsgo-invocation.js';

const { createTsgoInvocation, resolveTsgoBin } = tsgoInvocation;

function createNativePreviewFixture(bin) {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), 'tsgo invocation ')),
  );
  const packageRoot = path.join(
    root,
    'node_modules',
    '@typescript',
    'native-preview',
  );
  mkdirSync(path.join(packageRoot, 'bin'), { recursive: true });
  writeFileSync(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({
      name: '@typescript/native-preview',
      version: '0.0.0-test',
      ...(bin === undefined ? {} : { bin }),
    }),
  );

  return {
    packageRoot,
    requireFrom: createRequire(path.join(root, 'consumer.mjs')),
    root,
  };
}

for (const [label, bin, expectedEntry] of [
  ['string bin', './bin/string-tsgo.js', './bin/string-tsgo.js'],
  ['named tsgo bin', { tsgo: './bin/named-tsgo.js' }, './bin/named-tsgo.js'],
  ['missing bin fallback', undefined, 'bin/tsgo.js'],
]) {
  test(`resolves ${label} from the requested package origin`, () => {
    const fixture = createNativePreviewFixture(bin);
    try {
      assert.equal(
        resolveTsgoBin({ requireFrom: fixture.requireFrom }),
        path.resolve(fixture.packageRoot, expectedEntry),
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
}

test('executes the Windows-safe invocation with argv preserved exactly', () => {
  const fixture = createNativePreviewFixture({ tsgo: './bin/tsgo.js' });
  try {
    const binPath = path.join(fixture.packageRoot, 'bin', 'tsgo.js');
    writeFileSync(
      binPath,
      'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n',
    );
    const args = [
      '-p',
      'C:\\repo with spaces\\config.json',
      'literal&pipe|caret^percent%bang!',
      'quote"value',
      'semi;colon',
    ];
    const invocation = createTsgoInvocation({
      args,
      platform: 'win32',
      requireFrom: fixture.requireFrom,
    });

    assert.equal(invocation.command, process.execPath);
    assert.equal(invocation.argv[0], binPath);
    assert.equal(invocation.shell, false);
    assert.doesNotMatch(invocation.command, /\.(?:bat|cmd)$/iu);

    const result = spawnSync(invocation.command, invocation.argv, {
      encoding: 'utf8',
      shell: invocation.shell,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), args);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
