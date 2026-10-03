import { execFileSync, fork } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const workerMarker = 'ULTRAMODERN_GENERATED_ENTRY_WORKER';
const probeVariable = 'ULTRAMODERN_GENERATED_ENTRY_PROBE';
const prefix = 'target-ultramodern-octane-generated-';

function removeOwnedProbe(probe, probeParent) {
  if (
    path.dirname(probe) !== probeParent ||
    !path.basename(probe).startsWith(prefix)
  )
    throw new Error(
      `Refusing cleanup outside the exact owned cache leaf: ${probe}`,
    );
  fs.rmSync(probe, { recursive: true, force: true });
}

export function generatedEntryWorkerProbe() {
  return process.env[workerMarker] === '1'
    ? process.env[probeVariable]
    : undefined;
}

/** DiskGuardian release validates the original path/inode. After removal, its
 * exact-path janitor is the supported way to prune only that absent record. */
export async function pruneRemovedGeneratedEntryArtifact(probe, execute) {
  if (fs.existsSync(probe))
    throw new Error(
      `Refusing absent-record cleanup for an existing path: ${probe}`,
    );
  if (!path.isAbsolute(probe) || !path.basename(probe).startsWith(prefix))
    throw new Error(
      `Refusing absent-record cleanup for an unowned path: ${probe}`,
    );
  return execute(['cleanup', '--apply', '--only', probe, '--no-caches']);
}

function processTable() {
  return execFileSync('ps', ['-axo', 'pid=,ppid=,pgid=,stat='], {
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer: 4 * 1024 * 1024,
  })
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [pid, parent, group, state] = line.trim().split(/\s+/u);
      return {
        pid: Number(pid),
        parent: Number(parent),
        group: Number(group),
        state,
      };
    });
}

function signalGroup(group, signal) {
  if (!Number.isInteger(group) || group <= 1 || group === process.pid)
    throw new Error(`Refusing an unowned process group: ${group}`);
  try {
    process.kill(-group, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') {
      const members = processTable().filter(entry => entry.group === group);
      if (members.every(entry => entry.state.startsWith('Z'))) return;
      throw new Error(
        `Cannot send ${signal} to owned process group ${group}: ${error.code}; live PIDs ${members.map(entry => entry.pid).join(', ')}`,
        { cause: error },
      );
    }
  }
}

const delay = milliseconds =>
  new Promise(resolve => setTimeout(resolve, milliseconds));

/** The controller outlives native Rsbuild's process.exit() signal handler.
 * It owns exactly one newly allocated cache leaf and its own detached worker.
 * The native browser host belongs to the controller, including pending launch;
 * its worker only requests a connection endpoint through native IPC. */
export async function runGeneratedEntryController({
  script,
  args,
  admissionRoot,
  probeParent,
  register,
  release,
  launchBrowser,
  timeoutMs = 600_000,
  shutdownGraceMs = 35_000,
}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 600_000)
    throw new Error('Generated-entry timeout must be bounded.');
  if (
    !Number.isInteger(shutdownGraceMs) ||
    shutdownGraceMs <= 0 ||
    shutdownGraceMs > 60_000
  )
    throw new Error('Generated-entry shutdown grace must be bounded.');
  if (process.platform === 'win32')
    throw new Error(
      'Generated-entry process ownership requires POSIX process groups.',
    );
  const controller = new AbortController();
  const handlers = new Map();
  let worker;
  let completion;
  let stopPromise;
  let exit;
  let failure;
  let probe;
  let registrationAttempted = false;
  let registered = false;
  let forcedWorkerStop = false;
  let workerEvidence;
  let browser;
  let browserCreation;
  let output = '';
  const browserGroups = new Set();
  const cleanupFailures = [];
  const evidence = {
    passed: false,
    owningSourceProbe: true,
    packedPublicProof: false,
  };
  const receipt = path.join(admissionRoot, 'generated-entry-evidence.json');
  fs.writeFileSync(
    receipt,
    `${JSON.stringify({ ...evidence, pending: true })}\n`,
  );

  // Rsbuild/Rspack's native compiler pool uses worker threads in this process.
  // Detached browser hosts belong to the controller, never to this worker.
  function hardStop() {
    if (!worker?.pid) return;
    forcedWorkerStop = true;
    signalGroup(worker.pid, 'SIGKILL');
  }

  function stop() {
    if (!worker || exit) return Promise.resolve();
    if (!worker.pid) return completion?.catch(() => {});
    return (stopPromise ??= (async () => {
      signalGroup(worker.pid, 'SIGTERM');
      const timer = setTimeout(() => {
        try {
          hardStop();
        } catch (error) {
          cleanupFailures.push(error);
          // Still stop the known worker group if process-table inspection failed.
          try {
            signalGroup(worker.pid, 'SIGKILL');
          } catch (stopError) {
            cleanupFailures.push(stopError);
          }
        }
      }, shutdownGraceMs);
      try {
        await completion;
      } finally {
        clearTimeout(timer);
      }
    })());
  }

  function interrupt(reason) {
    controller.abort(reason);
    void stop().catch(error => cleanupFailures.push(error));
  }
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = () =>
      interrupt(
        new Error(`Generated-entry admission interrupted by ${signal}`),
      );
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  const deadline = setTimeout(
    () =>
      interrupt(new Error(`Generated-entry admission exceeded ${timeoutMs}ms`)),
    timeoutMs,
  );

  async function closeProcessGroups() {
    if (!worker?.pid) return;
    const groups = new Set([worker.pid, ...browserGroups]);
    for (const group of groups) signalGroup(group, 'SIGTERM');
    const alive = () =>
      processTable().filter(
        entry => groups.has(entry.group) && !entry.state.startsWith('Z'),
      );
    const until = Date.now() + 2_000;
    while (alive().length && Date.now() < until) await delay(25);
    for (const group of groups) signalGroup(group, 'SIGKILL');
    const killedUntil = Date.now() + 2_000;
    while (alive().length && Date.now() < killedUntil) await delay(25);
    const survivors = alive();
    if (survivors.length)
      throw new Error(
        `Owned generated-entry processes survived cleanup: ${survivors.map(entry => entry.pid).join(', ')}`,
      );
  }

  async function closeBrowserHost() {
    if (!browser) return;
    let timer;
    try {
      await Promise.race([
        Promise.resolve().then(() => browser.close()),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Native browser host cleanup timed out.')),
            shutdownGraceMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  try {
    controller.signal.throwIfAborted();
    fs.mkdirSync(probeParent, { recursive: true });
    probe = fs.mkdtempSync(path.join(probeParent, prefix));
    registrationAttempted = true;
    await register(probe, process.pid);
    registered = true;
    controller.signal.throwIfAborted();
    worker = fork(script, args, {
      cwd: admissionRoot,
      detached: true,
      env: {
        ...process.env,
        [workerMarker]: '1',
        [probeVariable]: probe,
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    completion = new Promise((resolve, reject) => {
      worker.once('error', reject);
      worker.once('close', (code, signal) => {
        exit = { code, signal };
        resolve();
      });
    });
    for (const stream of [worker.stdout, worker.stderr]) {
      stream.on('data', bytes => {
        output = `${output}${bytes}`.slice(-8_192);
        process.stdout.write(bytes);
      });
    }
    worker.on('message', message => {
      if (message?.type === 'generated-entry-request-browser') {
        if (!launchBrowser || browserCreation) {
          interrupt(
            new Error(
              'Worker requested an unavailable or duplicate browser host.',
            ),
          );
          return;
        }
        browserCreation = Promise.resolve()
          .then(launchBrowser)
          .then(created => {
            browser = created;
            const pid = created.process().pid;
            if (
              !Number.isInteger(pid) ||
              pid <= 1 ||
              pid === process.pid ||
              pid === worker.pid
            )
              throw new Error(
                'Native browser host returned an invalid owner PID.',
              );
            browserGroups.add(pid);
            if (!controller.signal.aborted && worker.connected)
              worker.send(
                {
                  type: 'generated-entry-browser-ready',
                  endpoint: created.wsEndpoint(),
                },
                error => {
                  if (error && !exit) interrupt(error);
                },
              );
          });
        void browserCreation.catch(interrupt);
      } else if (message?.type === 'generated-entry-evidence') {
        workerEvidence = message.evidence;
      }
    });
    if (controller.signal.aborted) await stop();
    await completion;
    controller.signal.throwIfAborted();
    if (exit.code !== 0 || workerEvidence?.passed !== true) {
      throw new Error(
        workerEvidence?.failure ??
          `Generated-entry worker failed (${exit.code ?? exit.signal}).\n${output}`,
      );
    }
    Object.assign(evidence, workerEvidence);
  } catch (error) {
    failure = error;
    Object.assign(evidence, workerEvidence, {
      passed: false,
      failure: String(error),
    });
  } finally {
    clearTimeout(deadline);
    let ownersStopped = false;
    try {
      if (worker && !exit) await stop();
    } catch (error) {
      cleanupFailures.push(error);
    }
    // Creation retains ownership until the native bounded launcher settles,
    // including when a worker exits before its browser endpoint is delivered.
    await browserCreation?.catch(() => {});
    try {
      await closeBrowserHost();
    } catch (error) {
      cleanupFailures.push(error);
    }
    try {
      await closeProcessGroups();
      ownersStopped = true;
    } catch (error) {
      cleanupFailures.push(error);
    }
    // Never remove an output tree while a native owner may still be alive.
    let probeRemoved = false;
    let registrationReleased = false;
    if (probe && ownersStopped) {
      try {
        removeOwnedProbe(probe, probeParent);
        probeRemoved = true;
      } catch (error) {
        cleanupFailures.push(error);
      }
      if (probeRemoved && registrationAttempted) {
        try {
          await release(probe);
          registrationReleased = true;
        } catch (error) {
          cleanupFailures.push(error);
        }
      }
    }
    for (const [signal, handler] of handlers)
      process.removeListener(signal, handler);
    if (controller.signal.aborted) {
      failure ??= controller.signal.reason;
      Object.assign(evidence, { passed: false, failure: String(failure) });
    }
    evidence.cleanup = {
      controllerPid: process.pid,
      workerPid: worker?.pid,
      probePath: probe,
      registered,
      forcedWorkerStop,
      workerStopped: !worker?.pid || Boolean(exit),
      processOwnersStopped: ownersStopped,
      browserProcessGroups: [...browserGroups],
      probeRemoved,
      registrationReleased,
    };
    if (cleanupFailures.length) {
      evidence.passed = false;
      evidence.cleanupFailures = [
        ...(evidence.cleanupFailures ?? []),
        ...cleanupFailures.map(String),
      ];
      failure ??= new AggregateError(
        cleanupFailures,
        'Generated-entry admission cleanup failed.',
      );
      evidence.failure ??= String(failure);
    }
    fs.writeFileSync(receipt, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(JSON.stringify(evidence));
  }
  if (failure) throw failure;
  return evidence;
}
