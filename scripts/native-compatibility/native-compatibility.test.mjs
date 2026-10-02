import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertConsumerLockfile,
  assertInstalledConsumer,
  createNativeConsumer,
  packedOverrides,
  readNativeErrorBody,
  upstreamCommit,
  upstreamDependencies,
} from './consumer.mjs';
import { compatibilityCommand } from './run-native-compatibility.mjs';

const ownedDirectory = callback => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'native-compatibility-test-'),
  );
  try {
    return callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

test('non-ending HTTP error diagnostics return partial text even if cancellation stalls', {
  timeout: 1000,
}, async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('Native loader failed'));
      },
      cancel() {
        cancelled = true;
        return new Promise(() => {});
      },
    }),
    { status: 500 },
  );
  const controller = new AbortController();
  const body = await readNativeErrorBody(response, controller, {
    timeoutMs: 20,
  });
  assert.equal(response.status, 500);
  assert.match(body, /^Native loader failed\n\[Diagnostic body timed out/);
  assert.equal(controller.signal.aborted, true);
  assert.equal(response.body.locked, false);
  assert.equal(cancelled, true);
});

test('oversized HTTP error diagnostics cancel the remaining body at the byte cap', {
  timeout: 1000,
}, async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('Native loader failed'));
      },
      cancel() {
        cancelled = true;
      },
    }),
    { status: 500 },
  );
  const controller = new AbortController();
  assert.equal(
    await readNativeErrorBody(response, controller, { maxBytes: 6 }),
    'Native\n[Diagnostic body truncated at 6 bytes]',
  );
  assert.equal(response.status, 500);
  assert.equal(controller.signal.aborted, true);
  assert.equal(response.body.locked, false);
  assert.equal(cancelled, true);
});

test('HTTP error diagnostics retain text when a later body read fails', async () => {
  let reads = 0;
  const response = new Response(
    new ReadableStream({
      pull(controller) {
        if (reads++ === 0)
          controller.enqueue(new TextEncoder().encode('Native loader failed'));
        else controller.error(new Error('socket closed'));
      },
    }),
    { status: 500 },
  );
  const controller = new AbortController();
  assert.equal(
    await readNativeErrorBody(response, controller),
    'Native loader failed\n[Diagnostic body read failed: socket closed]',
  );
  assert.equal(response.status, 500);
  assert.equal(controller.signal.aborted, true);
  assert.equal(response.body.locked, false);
});

test('upstream baseline pins every native package to the fixed audited commit', () => {
  const calls = [];
  const dependencies = upstreamDependencies(args => {
    calls.push(args);
    return args[0] === 'rev-parse'
      ? upstreamCommit
      : JSON.stringify({
          name: {
            'packages/solutions/app-tools/package.json': '@modern-js/app-tools',
            'packages/runtime/plugin-runtime/package.json':
              '@modern-js/runtime',
            'packages/cli/plugin-bff/package.json': '@modern-js/plugin-bff',
            'packages/server/server-runtime/package.json':
              '@modern-js/server-runtime',
          }[args[1].slice(upstreamCommit.length + 1)],
          version: '3.8.2',
        });
  });
  assert.deepEqual(Object.values(dependencies), [
    '3.8.2',
    '3.8.2',
    '3.8.2',
    '3.8.2',
  ]);
  assert.ok(calls.every(args => args[1].startsWith(upstreamCommit)));
  assert.throws(() => upstreamDependencies(() => 'different-commit'));
});

test('packed consumers reject changed artifacts and sidecars from another cohort', () =>
  ownedDirectory(root => {
    const tarball = path.join(root, 'artifact.tgz');
    fs.writeFileSync(tarball, 'packed artifact');
    const packed = {
      tarball,
      integrity: createHash('sha256').update('packed artifact').digest('hex'),
    };
    const manifest = {
      packages: Object.fromEntries(
        [
          '@modern-js/app-tools',
          '@modern-js/runtime',
          '@modern-js/plugin-bff',
          '@modern-js/server-runtime',
        ].map(name => [name, packed]),
      ),
      sidecars: { '@bleedingdev/renderer': { ...packed, version: '1.0.0' } },
      edges: [
        {
          name: 'renderer',
          spec: 'npm:@bleedingdev/renderer@1.0.0',
          target: '@bleedingdev/renderer',
          version: '1.0.0',
        },
      ],
    };
    assert.equal(
      packedOverrides(manifest)['renderer@npm:@bleedingdev/renderer@1.0.0'],
      `file:${tarball}`,
    );
    assert.throws(
      () =>
        packedOverrides({
          ...manifest,
          sidecars: {
            '@bleedingdev/renderer': { ...packed, version: '2.0.0' },
          },
        }),
      /Missing packed sidecar/,
    );
    fs.writeFileSync(tarball, 'changed artifact');
    assert.throws(
      () => packedOverrides(manifest),
      /Packed prerequisite changed/,
    );
  }));

test('upstream consumer rejects fork artifacts and framework source links', () =>
  ownedDirectory(root => {
    const appDir = path.join(root, 'app');
    const dependency = path.join(appDir, 'node_modules/@modern-js/runtime');
    fs.mkdirSync(dependency, { recursive: true });
    fs.writeFileSync(
      path.join(dependency, 'package.json'),
      JSON.stringify({ name: '@modern-js/runtime', version: '3.8.2' }),
    );
    fs.writeFileSync(
      path.join(appDir, 'pnpm-lock.yaml'),
      'packages:\n  "@bleedingdev/renderer@1.0.0": {}\n',
    );
    assert.throws(
      () =>
        assertInstalledConsumer(appDir, 'upstream', {
          '@modern-js/runtime': '3.8.2',
        }),
      /must not consume fork/,
    );
    fs.writeFileSync(path.join(appDir, 'pnpm-lock.yaml'), 'packages: {}\n');
    fs.writeFileSync(
      path.join(dependency, 'package.json'),
      JSON.stringify({
        name: '@modern-js/runtime',
        version: '3.8.2',
        dependencies: { renderer: 'workspace:*' },
      }),
    );
    assert.throws(
      () =>
        assertInstalledConsumer(appDir, 'upstream', {
          '@modern-js/runtime': '3.8.2',
        }),
      /leaked workspace protocol/,
    );
  }));

test('failed consumer setup removes only its own root', () =>
  ownedDirectory(root => {
    const sentinel = path.join(root, 'unrelated');
    fs.mkdirSync(sentinel);
    const previous = process.env.MODERN_TEST_PACKAGE_MANIFEST;
    process.env.MODERN_TEST_PACKAGE_MANIFEST = path.join(
      root,
      'missing-manifest.json',
    );
    try {
      assert.throws(
        () => createNativeConsumer('fork', { tempDir: root }),
        /ENOENT/,
      );
      assert.deepEqual(fs.readdirSync(root), ['unrelated']);
    } finally {
      if (previous === undefined)
        delete process.env.MODERN_TEST_PACKAGE_MANIFEST;
      else process.env.MODERN_TEST_PACKAGE_MANIFEST = previous;
    }
  }));

test('lockfile provenance checks dependency references, not settings key suffixes', () => {
  const published = [
    'lockfileVersion: "9.0"',
    'settings:',
    '  excludeLinksFromLockfile: false',
    'importers:',
    '  .:',
    '    dependencies:',
    '      "@modern-js/runtime":',
    '        specifier: 3.8.2',
    '        version: 3.8.2',
    'packages:',
    '  "@modern-js/runtime@3.8.2":',
    '    resolution: {integrity: sha512-published}',
  ].join('\n');
  assert.doesNotThrow(() => assertConsumerLockfile(published, 'upstream'));
  for (const protocol of ['file:', 'link:', 'workspace:']) {
    assert.throws(
      () =>
        assertConsumerLockfile(
          published.replace(
            'specifier: 3.8.2',
            `specifier: ${protocol}../runtime`,
          ),
          'upstream',
        ),
      /must use published/,
    );
  }
  assert.throws(
    () =>
      assertConsumerLockfile(
        published.replace(
          '@modern-js/runtime@3.8.2',
          '@modern-js/runtime@file:runtime.tgz',
        ),
        'upstream',
      ),
    /must use published/,
  );
  assert.throws(
    () =>
      assertConsumerLockfile(
        'packages:\n  "@bleedingdev/renderer@3.8.2": {}\n',
        'fork',
      ),
    /must come from this build/,
  );
  assert.doesNotThrow(() =>
    assertConsumerLockfile(
      'packages:\n  "@bleedingdev/renderer@file:renderer.tgz": {}\n',
      'fork',
    ),
  );
});

test('default acceptance runs native baseline, plain TanStack, RSC and federation', () => {
  const command = compatibilityCommand(['--prepared']);
  assert.ok(command.args.includes('--prepared'));
  assert.ok(
    command.args.includes('integration/native-compatibility/index.test.ts'),
  );
  assert.ok(
    command.args.includes('integration/routes-tanstack-mf/test/index.test.ts'),
  );
  assert.ok(
    command.args.includes('integration/routes-tanstack/tests/index.test.ts'),
  );
  assert.ok(
    command.args.includes(
      'integration/routes-tanstack-rsc/tests/index.test.ts',
    ),
  );
  assert.equal(command.env.NATIVE_COMPATIBILITY_TARGET, 'all');
  assert.throws(() => compatibilityCommand(['--target', 'latest']), /--target/);
});

test('acceptance subprocess failure is the runner exit status', () =>
  ownedDirectory(root => {
    if (process.platform === 'win32') return;
    const pnpm = path.join(root, 'pnpm');
    fs.writeFileSync(pnpm, '#!/bin/sh\nexit 23\n', { mode: 0o755 });
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL('./run-native-compatibility.mjs', import.meta.url),
        ),
        '--target',
        'upstream',
      ],
      {
        env: {
          ...process.env,
          PATH: `${root}${path.delimiter}${process.env.PATH ?? ''}`,
        },
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, 23, result.stderr);
  }));
