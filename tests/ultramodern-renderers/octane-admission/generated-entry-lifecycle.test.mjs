import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  pruneRemovedGeneratedEntryArtifact,
  runGeneratedEntryController,
} from './generated-entry-lifecycle.mjs';

const helper = new URL('./generated-entry-lifecycle.mjs', import.meta.url).href;
const workerSource = `
const [mode] = process.argv.slice(2);
const send = message => new Promise((resolve, reject) => process.send(message, error => error ? reject(error) : resolve()));
if (mode === 'early') throw new Error('primary early initialization failure');
process.on('SIGTERM', () => { if (mode !== 'force') process.exit(143); });
const endpoint = new Promise(resolve => process.on('message', message => {
  if (message?.type === 'generated-entry-browser-ready') resolve(message.endpoint);
}));
await send({ type: 'generated-entry-request-browser' });
await endpoint;
if (mode === 'force') {
  setInterval(() => {}, 1000);
  await new Promise(() => {});
}
if (mode === 'partial') {
  await send({ type: 'generated-entry-evidence', evidence: { passed: false, failure: 'primary partial initialization failure', cleanupFailures: ['resource close rejected'] } });
  process.disconnect();
  process.exit(1);
}
await send({ type: 'generated-entry-evidence', evidence: { passed: true, lifecycleFixture: true } });
process.disconnect();
process.exit(0);
`;
const browserHostSource = `
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
export async function launchBrowser(root, mode) {
  if (mode === 'late') {
    console.log('BROWSER_INITIALIZING');
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  const child = spawn(process.execPath, ['-e', "process.stdout.write('ready'); setInterval(() => {}, 1000)"], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  const completion = new Promise(resolve => child.once('close', resolve));
  await new Promise((resolve, reject) => {
    child.stdout.once('data', resolve);
    child.once('error', reject);
  });
  child.unref();
  fs.writeFileSync(path.join(root, 'browser-pid'), String(child.pid));
  return {
    process: () => child,
    wsEndpoint: () => 'lifecycle-fixture-endpoint',
    async close() {
      if (mode === 'close-error') throw new Error('primary browser host close failure');
      if (mode === 'close-timeout') return new Promise(() => {});
      if (child.exitCode === null && child.signalCode === null) process.kill(-child.pid, 'SIGTERM');
      await completion;
    },
  };
}
`;

function alive(pid) {
  return execFileSync('ps', ['-axo', 'pid=,stat='], { encoding: 'utf8' })
    .split('\n')
    .some(line => {
      const [candidate, state] = line.trim().split(/\s+/u);
      return Number(candidate) === pid && state && !state.startsWith('Z');
    });
}

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'octane-lifecycle-test-'));
  const script = path.join(root, 'worker.mjs');
  const hostScript = path.join(root, 'browser-host.mjs');
  const probeParent = path.join(root, 'cache');
  fs.mkdirSync(probeParent);
  const sibling = path.join(probeParent, 'borrowed-existing-output');
  fs.mkdirSync(sibling);
  fs.writeFileSync(path.join(sibling, 'keep'), 'existing output');
  fs.writeFileSync(script, workerSource);
  fs.writeFileSync(hostScript, browserHostSource);
  t.after(() => {
    const pidFile = path.join(root, 'browser-pid');
    if (fs.existsSync(pidFile)) {
      try {
        const pid = Number(fs.readFileSync(pidFile));
        if (alive(pid)) process.kill(-pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  const { launchBrowser } = await import(pathToFileURL(hostScript));
  return { root, script, hostScript, probeParent, sibling, launchBrowser };
}

function controllerOptions(f, mode, changes = {}) {
  const events = [];
  return {
    events,
    options: {
      script: f.script,
      args: [mode],
      admissionRoot: f.root,
      probeParent: f.probeParent,
      timeoutMs: 5_000,
      shutdownGraceMs: 200,
      launchBrowser: () => f.launchBrowser(f.root, mode),
      register: async probe => {
        assert.ok(fs.existsSync(probe));
        events.push('registered');
      },
      release: async probe => {
        assert.equal(fs.existsSync(probe), false);
        const pidFile = path.join(f.root, 'browser-pid');
        if (fs.existsSync(pidFile))
          assert.equal(alive(Number(fs.readFileSync(pidFile))), false);
        events.push('released-after-owner-stopped-and-leaf-removed');
      },
      ...changes,
    },
  };
}

function assertReleased(f) {
  const receipt = JSON.parse(
    fs.readFileSync(path.join(f.root, 'generated-entry-evidence.json')),
  );
  assert.equal(receipt.cleanup.workerStopped, true);
  assert.equal(receipt.cleanup.processOwnersStopped, true);
  assert.equal(receipt.cleanup.probeRemoved, true);
  assert.equal(receipt.cleanup.registrationReleased, true);
  assert.equal(fs.existsSync(receipt.cleanup.probePath), false);
  assert.equal(
    fs.readFileSync(path.join(f.sibling, 'keep'), 'utf8'),
    'existing output',
  );
  return receipt;
}

test('an import/initialization failure keeps the primary error and releases its exact leaf', async t => {
  const f = await fixture(t);
  const { options, events } = controllerOptions(f, 'early');
  await assert.rejects(
    runGeneratedEntryController(options),
    /primary early initialization failure/u,
  );
  assert.deepEqual(events, [
    'registered',
    'released-after-owner-stopped-and-leaf-removed',
  ]);
  assert.equal(assertReleased(f).passed, false);
});

test('a partially initialized worker keeps its primary error and closes all native owners', async t => {
  const f = await fixture(t);
  const { options } = controllerOptions(f, 'partial');
  await assert.rejects(
    runGeneratedEntryController(options),
    /primary partial initialization failure/u,
  );
  const receipt = assertReleased(f);
  assert.match(receipt.failure, /primary partial initialization failure/u);
  assert.deepEqual(receipt.cleanupFailures, ['resource close rejected']);
});

test('success is published only after detached resources, leaf and registration close', async t => {
  const f = await fixture(t);
  const { options, events } = controllerOptions(f, 'success');
  assert.equal((await runGeneratedEntryController(options)).passed, true);
  assert.deepEqual(events, [
    'registered',
    'released-after-owner-stopped-and-leaf-removed',
  ]);
  assertReleased(f);
});

test('a registration that fails after writing is still released without starting a worker', async t => {
  const f = await fixture(t);
  const { options, events } = controllerOptions(f, 'success', {
    register: async () => {
      throw new Error('primary registration failure after write');
    },
  });
  await assert.rejects(
    runGeneratedEntryController(options),
    /primary registration failure after write/u,
  );
  assert.deepEqual(events, ['released-after-owner-stopped-and-leaf-removed']);
  assert.equal(assertReleased(f).cleanup.workerPid, undefined);
});

test('post-removal registry cleanup uses the exact absent-record prune and preserves another registration', async t => {
  const f = await fixture(t);
  const registry = new Map([[f.sibling, fs.statSync(f.sibling).ino]]);
  const commands = [];
  const execute = async args => {
    commands.push(args);
    if (args[0] === 'release' && !fs.existsSync(args[1]))
      throw new Error('DiskGuardian release requires the original path/inode.');
    assert.deepEqual(args, [
      'cleanup',
      '--apply',
      '--only',
      args[3],
      '--no-caches',
    ]);
    assert.equal(fs.existsSync(args[3]), false);
    registry.delete(args[3]);
  };
  const { options } = controllerOptions(f, 'early', {
    register: async probe => registry.set(probe, fs.statSync(probe).ino),
    release: probe => pruneRemovedGeneratedEntryArtifact(probe, execute),
  });
  await assert.rejects(
    runGeneratedEntryController(options),
    /primary early initialization failure/u,
  );
  const receipt = assertReleased(f);
  assert.deepEqual(commands, [
    ['cleanup', '--apply', '--only', receipt.cleanup.probePath, '--no-caches'],
  ]);
  await assert.rejects(
    execute(['release', receipt.cleanup.probePath]),
    /original path\/inode/u,
  );
  assert.deepEqual([...registry], [[f.sibling, fs.statSync(f.sibling).ino]]);
});

test('absent-record prune refuses a still-existing leaf', async t => {
  const f = await fixture(t);
  const probe = fs.mkdtempSync(
    path.join(f.probeParent, 'target-ultramodern-octane-generated-'),
  );
  let invoked = false;
  await assert.rejects(
    pruneRemovedGeneratedEntryArtifact(probe, async () => {
      invoked = true;
    }),
    /existing path/u,
  );
  assert.equal(invoked, false);
  assert.equal(fs.existsSync(probe), true);
});

test('a missing worker script fails without leaking the owned leaf', async t => {
  const f = await fixture(t);
  const { options } = controllerOptions(f, 'success', {
    script: path.join(f.root, 'missing-worker.mjs'),
  });
  await assert.rejects(
    runGeneratedEntryController(options),
    /MODULE_NOT_FOUND|Cannot find module/u,
  );
  assertReleased(f);
});

test('a bounded hard stop closes native owners and preserves unrelated processes', async t => {
  const f = await fixture(t);
  const sibling = spawn(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'],
    { detached: true, stdio: 'ignore' },
  );
  t.after(() => {
    try {
      process.kill(-sibling.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  });
  const { options } = controllerOptions(f, 'force', {
    timeoutMs: 250,
    shutdownGraceMs: 100,
  });
  await assert.rejects(runGeneratedEntryController(options), /exceeded 250ms/u);
  assert.equal(assertReleased(f).cleanup.forcedWorkerStop, true);
  assert.equal(alive(sibling.pid), true);
});

test('native host close rejection preserves failure while OS-owner termination permits cleanup', async t => {
  const f = await fixture(t);
  const { options } = controllerOptions(f, 'close-error');
  await assert.rejects(runGeneratedEntryController(options), /cleanup failed/u);
  const receipt = assertReleased(f);
  assert.equal(receipt.passed, false);
  assert.match(
    receipt.cleanupFailures[0],
    /primary browser host close failure/u,
  );
});

test('worker failure stays primary when controller cleanup also rejects', async t => {
  const f = await fixture(t);
  const { options } = controllerOptions(f, 'partial', {
    launchBrowser: () => f.launchBrowser(f.root, 'close-error'),
  });
  await assert.rejects(
    runGeneratedEntryController(options),
    /primary partial initialization failure/u,
  );
  const receipt = assertReleased(f);
  assert.match(receipt.failure, /primary partial initialization failure/u);
  assert.deepEqual(receipt.cleanupFailures, [
    'resource close rejected',
    'Error: primary browser host close failure',
  ]);
});

test('native host close timeout is bounded and still stops the owned group', async t => {
  const f = await fixture(t);
  const { options } = controllerOptions(f, 'close-timeout', {
    shutdownGraceMs: 100,
  });
  await assert.rejects(runGeneratedEntryController(options), /cleanup failed/u);
  assert.match(assertReleased(f).cleanupFailures[0], /cleanup timed out/u);
});

test('SIGTERM during final registry release cannot publish passed evidence', async t => {
  const f = await fixture(t);
  const { options } = controllerOptions(f, 'success', {
    release: async () => {
      process.emit('SIGTERM');
    },
  });
  await assert.rejects(
    runGeneratedEntryController(options),
    /interrupted by SIGTERM/u,
  );
  assert.equal(assertReleased(f).passed, false);
});

test('actual SIGTERM during pending native launch closes the late host after worker exit', async t => {
  const f = await fixture(t);
  const controllerScript = path.join(f.root, 'controller.mjs');
  fs.writeFileSync(
    controllerScript,
    `
import { runGeneratedEntryController } from ${JSON.stringify(helper)};
import { launchBrowser } from ${JSON.stringify(pathToFileURL(f.hostScript).href)};
try {
  await runGeneratedEntryController({
    script: ${JSON.stringify(f.script)}, args: ['late'],
    admissionRoot: ${JSON.stringify(f.root)}, probeParent: ${JSON.stringify(f.probeParent)},
    timeoutMs: 5000, shutdownGraceMs: 1000,
    register: async () => {}, release: async () => {},
    launchBrowser: () => launchBrowser(${JSON.stringify(f.root)}, 'late'),
  });
} catch (error) { process.exitCode = 1; }
`,
  );
  const controller = spawn(process.execPath, [controllerScript], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const completion = new Promise((resolve, reject) => {
    controller.once('error', reject);
    controller.once('close', resolve);
  });
  t.after(() => {
    if (controller.exitCode === null) controller.kill('SIGKILL');
  });
  let output = '';
  let signalled = false;
  controller.stdout.on('data', bytes => {
    output += bytes;
    if (!signalled && output.includes('BROWSER_INITIALIZING')) {
      signalled = true;
      process.kill(controller.pid, 'SIGTERM');
    }
  });
  controller.stderr.resume();
  await completion;
  assert.equal(signalled, true);
  assert.equal(controller.exitCode, 1);
  const receipt = assertReleased(f);
  assert.equal(receipt.passed, false);
  assert.match(receipt.failure, /interrupted by SIGTERM/u);
  assert.equal(receipt.cleanup.forcedWorkerStop, false);
  assert.equal(
    alive(Number(fs.readFileSync(path.join(f.root, 'browser-pid')))),
    false,
  );
});
