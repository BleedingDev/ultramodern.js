import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileFunction } from 'node:vm';
import { parseSync, types } from '@babel/core';
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

// Exercise the production method and its private shutdown functions without
// installing a framework or adding a test-only public process API.
const consumerSource = fs.readFileSync(
  new URL('./consumer.mjs', import.meta.url),
  'utf8',
);
const consumerAst = parseSync(consumerSource, {
  babelrc: false,
  configFile: false,
  sourceType: 'module',
});
const buildMethods = [];
const shutdownFunctions = [];
const guardianFunctions = [];
types.traverseFast(consumerAst, node => {
  if (types.isObjectMethod(node) && node.key.name === 'build')
    buildMethods.push(node);
  if (
    types.isFunctionDeclaration(node) &&
    ['terminate', 'stopChild'].includes(node.id?.name)
  )
    shutdownFunctions.push(node);
  if (types.isFunctionDeclaration(node) && node.id?.name === 'guardian')
    guardianFunctions.push(node);
});
assert.equal(
  buildMethods.length,
  1,
  'Expected one native consumer build method',
);
assert.equal(shutdownFunctions.length, 2, 'Expected native shutdown functions');
assert.equal(guardianFunctions.length, 1, 'Expected one artifact guardian');
const nativeGuardian = compileFunction(
  `${consumerSource.slice(
    guardianFunctions[0].start,
    guardianFunctions[0].end,
  )}\nreturn guardian;`,
  ['process', 'execFileSync', 'Date', 'Math', 'Atomics'],
);
const nativeBuild = compileFunction(
  `${shutdownFunctions
    .map(node => consumerSource.slice(node.start, node.end))
    .join('\n')}\nreturn {${consumerSource.slice(
    buildMethods[0].start,
    buildMethods[0].end,
  )}}.build;`,
  [
    'startCommand',
    'children',
    'appDir',
    'fs',
    'path',
    'guardian',
    'owner',
    'process',
    'execFileSync',
  ],
);

test('artifact registration retries exact guardian lock contention and preserves arguments', () => {
  const args = ['register', '/owned/node_modules', '--owner', 'test-owner'];
  const lock = Object.assign(new Error('guardian failed'), {
    status: 1,
    stdout: Buffer.from(
      JSON.stringify({
        status: 'failed',
        reason: 'another maintenance operation holds the lock',
      }),
    ),
  });
  let calls = 0;
  const waits = [];
  const guardian = nativeGuardian(
    { platform: 'darwin', env: {} },
    (command, actualArgs) => {
      assert.equal(command, 'disk-guardian-artifacts');
      assert.equal(actualArgs, args);
      if (++calls === 1) throw lock;
    },
    Date,
    Math,
    { wait: (_array, _index, _expected, delay) => waits.push(delay) },
  );
  guardian(args);
  assert.equal(calls, 2);
  assert.equal(waits.length, 1);
  assert.ok(waits[0] >= 100 && waits[0] <= 200);
});

test('artifact guardian fails immediately for non-lock or unstructured errors', () => {
  for (const [status, stdout] of [
    [
      1,
      JSON.stringify({
        status: 'failed',
        reason: 'owner or identity mismatch',
      }),
    ],
    [1, 'another maintenance operation holds the lock'],
    [
      2,
      JSON.stringify({
        status: 'failed',
        reason: 'another maintenance operation holds the lock',
      }),
    ],
  ]) {
    const failure = Object.assign(new Error('guardian failed'), {
      status,
      stdout: Buffer.from(stdout),
    });
    let calls = 0;
    const guardian = nativeGuardian(
      { platform: 'darwin', env: {} },
      () => {
        calls++;
        throw failure;
      },
      Date,
      Math,
      { wait: () => assert.fail('Unexpected artifact retry') },
    );
    assert.throws(
      () => guardian(['register', '/owned/node_modules']),
      error => {
        assert.equal(error.cause, failure);
        assert.ok(error.message.includes(stdout));
        return true;
      },
    );
    assert.equal(calls, 1);
  }
});

test('artifact guardian stops retrying after 150 seconds of lock contention', () => {
  let now = 0;
  let calls = 0;
  const failure = Object.assign(new Error('guardian failed'), {
    status: 1,
    stdout: Buffer.from(
      JSON.stringify({
        status: 'failed',
        reason: 'another maintenance operation holds the lock',
      }),
    ),
  });
  const guardian = nativeGuardian(
    { platform: 'darwin', env: {} },
    () => {
      calls++;
      throw failure;
    },
    { now: () => now },
    { ...Math, random: () => 0, floor: Math.floor, min: Math.min },
    {
      wait: (_array, _index, _expected, delay) => {
        now += delay;
      },
    },
  );
  assert.throws(
    () => guardian(['register', '/owned/node_modules']),
    error => {
      assert.equal(error.cause, failure);
      return true;
    },
  );
  assert.equal(now, 150_000);
  assert.equal(calls, 1501);
});

test('native builds stop descendants after the CLI exits on success and failure', {
  skip: process.platform === 'win32',
  timeout: 10_000,
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-build-process-'));
  const groups = new Set();
  try {
    for (const exitCode of [0, 19]) {
      let child;
      let output = '';
      const children = new Set();
      const failure = new Error('Native build failed');
      const startCommand = () => {
        child = spawn(
          process.execPath,
          [
            '-e',
            `const { spawn } = require('node:child_process');
const descendant = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); console.log("ready"); setInterval(() => {}, 1000)'], { stdio: ['ignore', 'pipe', 'ignore'] });
descendant.stdout.once('data', () => {
  console.log(descendant.pid);
  descendant.stdout.destroy();
  descendant.unref();
  process.exit(${exitCode});
});`,
          ],
          { detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
        );
        groups.add(child.pid);
        children.add(child);
        child.stdout.on('data', chunk => {
          output += chunk;
        });
        const exited = new Promise((resolve, reject) => {
          child.once('error', reject);
          child.once('close', code => {
            if (code === 0) resolve();
            else reject(failure);
          });
        });
        return { child, exited };
      };
      const build = nativeBuild(
        startCommand,
        children,
        root,
        fs,
        path,
        () => {},
        'test-owner',
        process,
        execFileSync,
      );
      if (exitCode === 0) await build('string');
      else await assert.rejects(build('string'), error => error === failure);
      assert.equal(child.exitCode, exitCode);
      assert.equal(children.size, 0);
      const descendantPid = Number(output.trim());
      assert.ok(descendantPid > 0, 'Expected the native CLI descendant PID');
      const deadline = Date.now() + 1000;
      let state;
      do {
        state = spawnSync('ps', ['-o', 'stat=', '-p', String(descendantPid)], {
          encoding: 'utf8',
        }).stdout.trim();
        if (!state || state.startsWith('Z')) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      } while (Date.now() < deadline);
      assert.ok(
        !state || state.startsWith('Z'),
        'Native build descendant is alive',
      );
      groups.delete(child.pid);
    }
  } finally {
    for (const pid of groups) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch (error) {
        assert.equal(error.code, 'ESRCH');
      }
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('native build cleanup preserves the original failure and keeps the child tracked', async () => {
  const failure = new Error('Native build failed');
  const cleanupFailure = new Error('Cannot stop native child');
  const child = { pid: 123, exitCode: 19, signalCode: null };
  const children = new Set([child]);
  const build = nativeBuild(
    () => ({ child, exited: Promise.reject(failure) }),
    children,
    '/unused',
    fs,
    path,
    () => {},
    'test-owner',
    {
      platform: 'linux',
      kill() {
        throw cleanupFailure;
      },
    },
    execFileSync,
  );
  await assert.rejects(build('string'), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [failure, cleanupFailure]);
    return true;
  });
  assert.equal(children.has(child), true);
});

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
    command.args.includes('integration/native-compatibility/upstream.test.ts'),
  );
  assert.ok(
    command.args.includes('integration/native-compatibility/fork.test.ts'),
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
  for (const target of ['upstream', 'fork']) {
    const selected = compatibilityCommand([
      '--prepared',
      '--native-only',
      '--target',
      target,
    ]);
    assert.deepEqual(
      selected.args.filter(argument => argument.endsWith('.test.ts')),
      [`integration/native-compatibility/${target}.test.ts`],
    );
    assert.equal(selected.env.NATIVE_COMPATIBILITY_TARGET, target);
  }
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
