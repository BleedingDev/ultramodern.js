import assert from 'node:assert/strict';
import { type ChildProcess, fork } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { buildSync } from 'esbuild';

const repoRoot = path.resolve(__dirname, '../../../../..');
const fixturePath = path.join(
  __dirname,
  'fixtures/manifest-recovery-node-child.cjs',
);

const waitForMessage = <T>(child: ChildProcess) =>
  new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for child process message'));
    }, 10_000);

    child.once('message', message => {
      clearTimeout(timeout);
      resolve(message as T);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `Child process exited before responding (code=${code}, signal=${signal})`,
        ),
      );
    });
  });

const reservePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      const { port } = address;
      server.close(error => {
        if (error) {
          reject(error);
        } else {
          resolve(port);
        }
      });
    });
  });

const findRuntimePath = () => {
  const packageStoreRoot = path.join(repoRoot, 'node_modules/.pnpm');
  const runtimeEntry = fs
    .readdirSync(packageStoreRoot)
    .find(entry => entry === '@module-federation+runtime@2.8.0');

  assert.ok(runtimeEntry, '@module-federation/runtime@2.8.0 must be installed');
  return path.join(
    packageStoreRoot,
    runtimeEntry,
    'node_modules/@module-federation/runtime/dist/index.cjs',
  );
};

test('Node SSR stays alive, reports typed degradation, and recovers without restart', async () => {
  const temporaryDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'modern-js-mf-recovery-'),
  );
  const recoveryPluginPath = path.join(
    temporaryDir,
    'manifest-recovery-runtime-plugin.cjs',
  );
  buildSync({
    entryPoints: [
      path.join(
        repoRoot,
        'packages/runtime/plugin-runtime/src/module-federation/manifest-recovery-runtime-plugin.ts',
      ),
    ],
    outfile: recoveryPluginPath,
    bundle: true,
    format: 'cjs',
    platform: 'node',
  });

  const remotePort = await reservePort();
  const stderr: string[] = [];
  const child = fork(
    fixturePath,
    [findRuntimePath(), recoveryPluginPath, String(remotePort)],
    {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    },
  );
  child.stderr?.on('data', chunk => stderr.push(String(chunk)));

  try {
    const ready = await waitForMessage<{
      type: 'shell-ready';
      port: number;
      pid: number;
    }>(child);
    assert.equal(ready.type, 'shell-ready');
    const shellUrl = `http://127.0.0.1:${ready.port}`;

    const unavailableResponse = await fetch(shellUrl);
    assert.equal(unavailableResponse.status, 503);
    assert.match(
      await unavailableResponse.text(),
      /data-mf-status="degraded" data-mf-error="RUNTIME-003"/,
    );
    assert.equal(child.exitCode, null);

    const healthyReadyPromise = waitForMessage<{
      type: 'remote-ready';
      mode: string;
    }>(child);
    child.send('remote-healthy');
    assert.deepEqual(await healthyReadyPromise, {
      type: 'remote-ready',
      mode: 'healthy',
    });

    const recoveredResponse = await fetch(shellUrl);
    assert.equal(recoveredResponse.status, 200);
    assert.match(await recoveredResponse.text(), /inventory live/);
    assert.equal(child.pid, ready.pid);
    assert.equal(child.exitCode, null);
    assert.match(stderr.join(''), /RUNTIME-003/);
  } finally {
    const exitPromise =
      child.exitCode === null
        ? new Promise<void>(resolve => child.once('exit', () => resolve()))
        : Promise.resolve();
    if (child.exitCode === null) {
      child.send('stop');
    }
    await exitPromise;
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
}, 30_000);

test('Node SSR preserves typed manifest schema failures', async () => {
  const temporaryDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'modern-js-mf-invalid-manifest-'),
  );
  const recoveryPluginPath = path.join(
    temporaryDir,
    'manifest-recovery-runtime-plugin.cjs',
  );
  buildSync({
    entryPoints: [
      path.join(
        repoRoot,
        'packages/runtime/plugin-runtime/src/module-federation/manifest-recovery-runtime-plugin.ts',
      ),
    ],
    outfile: recoveryPluginPath,
    bundle: true,
    format: 'cjs',
    platform: 'node',
  });

  const remotePort = await reservePort();
  const stderr: string[] = [];
  const child = fork(
    fixturePath,
    [findRuntimePath(), recoveryPluginPath, String(remotePort)],
    {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    },
  );
  child.stderr?.on('data', chunk => stderr.push(String(chunk)));

  try {
    const ready = await waitForMessage<{
      type: 'shell-ready';
      port: number;
    }>(child);
    const invalidReadyPromise = waitForMessage<{
      type: 'remote-ready';
      mode: string;
    }>(child);
    child.send('remote-invalid');
    assert.deepEqual(await invalidReadyPromise, {
      type: 'remote-ready',
      mode: 'invalid',
    });

    const invalidResponse = await fetch(`http://127.0.0.1:${ready.port}`);
    assert.equal(invalidResponse.status, 500);
    assert.match(
      await invalidResponse.text(),
      /data-mf-status="degraded" data-mf-error="RUNTIME-013"/,
    );
    assert.equal(child.exitCode, null);
    assert.match(stderr.join(''), /RUNTIME-013/);
  } finally {
    const exitPromise =
      child.exitCode === null
        ? new Promise<void>(resolve => child.once('exit', () => resolve()))
        : Promise.resolve();
    if (child.exitCode === null) {
      child.send('stop');
    }
    await exitPromise;
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
}, 30_000);
