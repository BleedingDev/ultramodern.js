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

function createTypeScriptFixture(bin, version = '7.0.2') {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), 'tsgo invocation ')),
  );
  const packageRoot = path.join(root, 'node_modules', 'typescript');
  mkdirSync(path.join(packageRoot, 'bin'), { recursive: true });
  writeFileSync(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({
      name: 'typescript',
      version,
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
  ['string bin', './bin/string-tsc.js', './bin/string-tsc.js'],
  ['named tsc bin', { tsc: './bin/named-tsc.js' }, './bin/named-tsc.js'],
]) {
  test(`resolves ${label} from the requested package origin`, () => {
    const fixture = createTypeScriptFixture(bin);
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

for (const [label, bin] of [
  ['missing bin', undefined],
  ['preview-only bin', { tsgo: './bin/tsgo.js' }],
]) {
  test(`rejects ${label} instead of inventing a compiler entry`, () => {
    const fixture = createTypeScriptFixture(bin);
    try {
      assert.throws(
        () => resolveTsgoBin({ requireFrom: fixture.requireFrom }),
        /does not expose its tsc CLI/,
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
}

for (const version of ['5.9.3', '7.0.1', '7.0.0-dev.20260707.2']) {
  test(`rejects unsupported compiler ${version}`, () => {
    const fixture = createTypeScriptFixture({ tsc: './bin/tsc.js' }, version);
    try {
      assert.throws(
        () => resolveTsgoBin({ requireFrom: fixture.requireFrom }),
        /Native TypeScript 7\.0\.2 is required/,
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
}

test('executes the Windows-safe invocation with argv preserved exactly', () => {
  const fixture = createTypeScriptFixture({ tsc: './bin/tsc.js' });
  try {
    const binPath = path.join(fixture.packageRoot, 'bin', 'tsc.js');
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
