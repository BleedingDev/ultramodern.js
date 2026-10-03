import { ChildProcess } from 'node:child_process';
import { channel } from 'node:diagnostics_channel';
import { once } from 'node:events';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { type Rspack, rspack } from '@rsbuild/core';
import { afterEach, describe, expect, it } from '@rstest/core';

const repositoryRoot = path.resolve(__dirname, '../../../../..');
const applicationRequire = createRequire(
  path.join(
    repositoryRoot,
    'tests/integration/routes-tanstack-mf/mf-remote/package.json',
  ),
);
const nativeRequire = createRequire(
  applicationRequire.resolve('@module-federation/modern-js-v3/ssr-plugin'),
);
const corePath = nativeRequire.resolve('@module-federation/dts-plugin/core');
const { rpc }: typeof import('@module-federation/dts-plugin/core') =
  nativeRequire('@module-federation/dts-plugin/core');
const { DtsPlugin }: typeof import('@module-federation/dts-plugin') =
  nativeRequire('@module-federation/dts-plugin');

interface ChildClose {
  code: number | null;
  signal: NodeJS.Signals | null;
}

interface OwnedChild {
  process: ChildProcess;
  closed: boolean;
  close: Promise<ChildClose>;
}

interface OwnedRoot {
  directory: string;
  children: OwnedChild[];
}

const roots: OwnedRoot[] = [];

function ownRoot(): OwnedRoot {
  const root = {
    directory: fs.realpathSync(
      fs.mkdtempSync(
        path.join(process.env.OWNED_TEMP_DIR ?? os.tmpdir(), 'um-dts-close-'),
      ),
    ),
    children: [],
  };
  roots.push(root);
  return root;
}

function ownChild(root: OwnedRoot, child: ChildProcess): OwnedChild {
  const completion = Promise.withResolvers<ChildClose>();
  const owned = { process: child, closed: false, close: completion.promise };
  child.once('close', (code, signal) => {
    owned.closed = true;
    completion.resolve({ code, signal });
  });
  root.children.push(owned);
  return owned;
}

function send(
  child: ChildProcess,
  message: Record<string, unknown>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    child.send(message, error => (error ? reject(error) : resolve()));
  });
}

async function closeOwnedChild(owned: OwnedChild): Promise<void> {
  if (!owned.closed) {
    if (owned.process.connected)
      await send(owned.process, { command: 'release' }).catch(() => undefined);
    if (
      !owned.closed &&
      owned.process.exitCode === null &&
      owned.process.signalCode === null
    )
      owned.process.kill('SIGTERM');
  }
  await owned.close;
}

afterEach(async () => {
  const errors: unknown[] = [];
  for (const root of roots.splice(0)) {
    try {
      await Promise.all(root.children.map(closeOwnedChild));
      fs.rmSync(root.directory, { recursive: true, force: true });
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length)
    throw new AggregateError(errors, 'Native DTS shutdown cleanup failed');
});

function childScript(root: OwnedRoot) {
  const script = path.join(root.directory, 'owned-rpc-child.cjs');
  const signalFile = path.join(root.directory, 'received-signal');
  fs.writeFileSync(
    script,
    `const fs = require('node:fs');
const { rpc } = require(${JSON.stringify(corePath)});
const hold = setInterval(() => {}, 1000);
rpc.exposeRpc(command => ({ command, pid: process.pid }));
process.on('message', message => {
  if (message?.type === rpc.RpcGMCallTypes.EXIT) {
    process.send({ event: 'native-exit', type: message.type, id: message.id });
  } else if (message?.command === 'disconnect') {
    process.disconnect();
  } else if (message?.command === 'release') {
    clearInterval(hold);
    process.exit(0);
  }
});
process.on('SIGTERM', () => {
  fs.writeFileSync(${JSON.stringify(signalFile)}, 'SIGTERM');
  clearInterval(hold);
  process.exit(0);
});
`,
  );
  return { script, signalFile };
}

type OwnedRpcCommand =
  | string
  | Readonly<{ compilerId: string; registrationId: string }>;

async function connectOwnedWorker(
  root: OwnedRoot,
  command: OwnedRpcCommand = 'ready',
) {
  const fixture = childScript(root);
  const worker = rpc.createRpcWorker<
    (command: OwnedRpcCommand) => {
      command: OwnedRpcCommand;
      pid: number;
    }
  >(fixture.script, {});
  const connected = worker.connect(command);
  const child = worker.process;
  expect(child).toBeInstanceOf(ChildProcess);
  if (!child) throw new Error('Native RPC did not create a child process');
  const owned = ownChild(root, child);
  expect(await connected).toEqual({ command, pid: child.pid });
  return { worker, owned, ...fixture };
}

function nativeExit(child: ChildProcess) {
  const observed = Promise.withResolvers<Record<string, unknown>>();
  const onMessage = (message: unknown) => {
    if (
      message &&
      typeof message === 'object' &&
      'event' in message &&
      message.event === 'native-exit'
    ) {
      child.off('message', onMessage);
      child.off('close', onClose);
      observed.resolve({ ...message });
    }
  };
  const onClose = () => {
    child.off('message', onMessage);
    observed.reject(new Error('RPC child closed before observing native EXIT'));
  };
  child.on('message', onMessage);
  child.once('close', onClose);
  void observed.promise.catch(() => undefined);
  return observed.promise;
}

function closeCompiler(compiler: Rspack.Compiler): Promise<void> {
  return new Promise((resolve, reject) => {
    compiler.close(error => (error ? reject(error) : resolve()));
  });
}

describe('Public native DTS shutdown', () => {
  it('binds each public frozen witness to its exact child despite a cloned compiler seed', async () => {
    const seed = Object.freeze({
      compilerId: 'native-client',
      registrationId: 'same-compiler-receiver',
    });
    const first = await connectOwnedWorker(ownRoot(), seed);
    const second = await connectOwnedWorker(ownRoot(), seed);
    const firstWitness = first.worker.workerWitness;
    const secondWitness = second.worker.workerWitness;
    if (!firstWitness || !secondWitness)
      throw new Error('Native RPC did not issue actual child witnesses');
    expect(Object.isFrozen(firstWitness)).toBe(true);
    expect(Object.isFrozen(secondWitness)).toBe(true);
    expect(firstWitness.pid).toBe(first.owned.process.pid);
    expect(secondWitness.pid).toBe(second.owned.process.pid);
    expect(firstWitness.pid).not.toBe(secondWitness.pid);
    let secondClosed = false;
    void secondWitness.closed.then(() => {
      secondClosed = true;
    });
    const exit = nativeExit(first.owned.process);
    const stopping = first.worker.terminate();
    await exit;
    expect(first.worker.workerWitness).toBeUndefined();
    await send(first.owned.process, { command: 'release' });
    await stopping;
    await firstWitness.closed;
    expect(first.owned.closed).toBe(true);
    expect(second.owned.closed).toBe(false);
    expect(secondClosed).toBe(false);
    expect(second.owned.process.connected).toBe(true);
    const secondExit = nativeExit(second.owned.process);
    const secondStopping = second.worker.terminate();
    await secondExit;
    await send(second.owned.process, { command: 'release' });
    await secondStopping;
    await secondWitness.closed;
    expect(secondClosed).toBe(true);
  });

  it('waits for actual child close after native EXIT and shares repeated termination', async () => {
    const { worker, owned } = await connectOwnedWorker(ownRoot());
    const observedExit = nativeExit(owned.process);
    const completion: Promise<void> = worker.terminate();
    expect(completion).toBeInstanceOf(Promise);
    const closedAtCompletion = completion.then(() => owned.closed);
    let settled = false;
    void completion.then(() => {
      settled = true;
    });

    expect(await observedExit).toEqual({
      event: 'native-exit',
      type: rpc.RpcGMCallTypes.EXIT,
      id: worker.id,
    });
    await Promise.resolve();
    expect(owned.closed).toBe(false);
    expect(owned.process.exitCode).toBeNull();
    expect(owned.process.signalCode).toBeNull();
    expect(settled).toBe(false);

    const repeated: Promise<void> = worker.terminate();
    expect(repeated).toBe(completion);
    await send(owned.process, { command: 'release' });
    await completion;
    expect(await closedAtCompletion).toBe(true);
    expect(owned.closed).toBe(true);
    expect(await owned.close).toEqual({ code: 0, signal: null });
    await repeated;
    expect(settled).toBe(true);
    expect(worker.terminate()).toBe(completion);
  });

  it('sends SIGTERM to its disconnected live child and waits for actual close', async () => {
    const { worker, owned, signalFile } = await connectOwnedWorker(ownRoot());
    const disconnected = once(owned.process, 'disconnect');
    await send(owned.process, { command: 'disconnect' });
    await disconnected;
    expect(owned.process.connected).toBe(false);
    expect(owned.closed).toBe(false);
    expect(owned.process.exitCode).toBeNull();
    expect(owned.process.signalCode).toBeNull();

    const completion: Promise<void> = worker.terminate();
    expect(completion).toBeInstanceOf(Promise);
    const closedAtCompletion = completion.then(() => owned.closed);
    await completion;
    expect(await closedAtCompletion).toBe(true);
    expect(owned.closed).toBe(true);
    expect(await owned.close).toEqual({ code: 0, signal: null });
    expect(fs.readFileSync(signalFile, 'utf8')).toBe('SIGTERM');
    expect(worker.terminate()).toBe(completion);
  });

  it('resolves termination without creating a child when never connected', async () => {
    const root = ownRoot();
    const { script } = childScript(root);
    const worker = rpc.createRpcWorker(script, {});
    expect(worker.process).toBeUndefined();
    const completion: Promise<void> = worker.terminate();
    expect(completion).toBeInstanceOf(Promise);
    const repeated: Promise<void> = worker.terminate();
    expect(repeated).toBeInstanceOf(Promise);
    await completion;
    await repeated;
    expect(worker.process).toBeUndefined();
    expect(root.children).toHaveLength(0);
  });

  it('does not spawn a native DevWorker when remote type URLs resolve after compiler close', async () => {
    const root = ownRoot();
    const previousCwd = process.cwd();
    const previousNodeEnv = process.env.NODE_ENV;
    const urls = Promise.withResolvers<Record<string, never>>();
    const requested = Promise.withResolvers<void>();
    const childProcessChannel = channel('child_process');
    const devWorkers: ChildProcess[] = [];
    const observationErrors: Error[] = [];
    const observe = (message: unknown) => {
      if (
        !message ||
        typeof message !== 'object' ||
        !('process' in message) ||
        !(message.process instanceof ChildProcess)
      ) {
        observationErrors.push(
          new Error('child_process diagnostic did not contain a ChildProcess'),
        );
        return;
      }
      const child = message.process;
      ownChild(root, child);
      if (
        child.spawnargs.some(argument =>
          /^fork-dev-worker\.(?:js|mjs|cjs)$/u.test(path.basename(argument)),
        )
      )
        devWorkers.push(child);
    };
    const events = [
      'SIGTERM',
      'SIGINT',
      'unhandledRejection',
      'uncaughtException',
    ] as const;
    const before = events.map(event => ({
      event,
      listeners: process.listeners(event),
    }));
    const removeNativeListeners: (() => void)[] = [];
    let compiler: Rspack.Compiler | undefined;
    let compilerClose: Promise<void> | undefined;
    let urlRequests = 0;
    const cleanupErrors: unknown[] = [];
    childProcessChannel.subscribe(observe);
    process.env.NODE_ENV = 'development';
    process.chdir(root.directory);
    try {
      compiler = rspack({
        mode: 'development',
        context: root.directory,
        entry: {},
        output: { path: path.join(root.directory, 'unused-output') },
      });
      try {
        new DtsPlugin({
          name: 'native-close-before-urls',
          remotes: {},
          dev: {
            disableLiveReload: true,
            disableHotTypesReload: false,
            disableDynamicRemoteTypeHints: true,
          },
          dts: {
            generateTypes: false,
            consumeTypes: {
              remoteTypeUrls: () => {
                urlRequests++;
                requested.resolve();
                return urls.promise;
              },
            },
          },
        }).apply(compiler);
      } finally {
        for (const { event, listeners } of before)
          for (const listener of process.listeners(event))
            if (!listeners.includes(listener))
              removeNativeListeners.push(() => process.off(event, listener));
      }

      await requested.promise;
      expect(urlRequests).toBe(1);
      expect(devWorkers).toHaveLength(0);
      compilerClose = closeCompiler(compiler);
      await compilerClose;
      urls.resolve({});
      await urls.promise;
      await nextTurn();
      await nextTurn();
      expect(observationErrors).toEqual([]);
      expect(devWorkers).toHaveLength(0);
      expect(fs.readdirSync(root.directory)).toEqual([]);
    } finally {
      urls.resolve({});
      try {
        if (compiler) await (compilerClose ?? closeCompiler(compiler));
        await nextTurn();
        await nextTurn();
      } catch (error) {
        cleanupErrors.push(error);
      }
      for (const remove of removeNativeListeners) remove();
      try {
        await Promise.all(root.children.map(closeOwnedChild));
      } finally {
        childProcessChannel.unsubscribe(observe);
        process.chdir(previousCwd);
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousNodeEnv;
      }
    }
    if (cleanupErrors.length)
      throw new AggregateError(cleanupErrors, 'Native compiler cleanup failed');
  });
});
