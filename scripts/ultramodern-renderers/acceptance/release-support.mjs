import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const guardian =
  process.env.DISK_GUARDIAN_ARTIFACTS ??
  '/Users/satan/bin/disk-guardian-artifacts';

export function readEvidence(file) {
  assert(path.isAbsolute(file), 'Evidence must use an absolute path');
  const bytes = fs.readFileSync(file);
  return {
    path: path.resolve(file),
    sha256: sha256(bytes),
    byteLength: bytes.length,
    value: JSON.parse(bytes),
  };
}

export function sourceEvidence(file) {
  const bytes = fs.readFileSync(file);
  return {
    path: path.resolve(file),
    byteLength: bytes.length,
    sha256: sha256(bytes),
  };
}

export function atomicJson(file, value) {
  assert(path.isAbsolute(file));
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      flag: 'wx',
    });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export function within(root, file) {
  const relative = path.relative(root, file);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export function assertBinding(value, binding) {
  for (const field of [
    'sourceRevision',
    'releaseVersion',
    'manifestSha256',
    'frameworkCohortDigest',
  ])
    assert.equal(
      value[field],
      binding[field],
      `Proof ${field} differs from the selected release`,
    );
}

/**
 * Registers a reproducible build/dependency subtree with the disk guardian when
 * it is installed. Missing guardian tooling is not an acceptance failure.
 */
const registered = new Map();

export function registerArtifact(directory, { owner, ownerPid, kind }) {
  fs.mkdirSync(directory, { recursive: true });
  if (!fs.existsSync(guardian)) return false;
  registered.set(directory, owner);
  const result = spawnSync(
    guardian,
    [
      'register',
      directory,
      '--owner',
      owner,
      '--owner-pid',
      String(ownerPid),
      '--grace-hours',
      '24',
      '--kind',
      kind,
    ],
    { encoding: 'utf8', timeout: 30_000 },
  );
  if (result.status !== 0)
    process.stderr.write(
      `[release] disk-guardian register failed for ${directory}: ${result.stderr || result.stdout}\n`,
    );
  return result.status === 0;
}

export function releaseArtifact(directory, owner) {
  registered.delete(directory);
  if (!fs.existsSync(guardian)) return;
  spawnSync(guardian, ['release', directory, '--owner', owner], {
    encoding: 'utf8',
    timeout: 30_000,
  });
}

/** Releases every registration this process made that is still outstanding. */
export function releaseRegisteredArtifacts() {
  for (const [directory, owner] of [...registered])
    releaseArtifact(directory, owner);
}

/** Releases and removes an owned leaf created by one probe. */
export async function removeOwnedLeaf(root, { owner } = {}) {
  assert(path.isAbsolute(root));
  if (owner) releaseArtifact(root, owner);
  fs.rmSync(root, { recursive: true, force: true });
  return { path: root, removed: !fs.existsSync(root) };
}

function groupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitBounded(completion, duration) {
  let timeout;
  try {
    return await Promise.race([
      completion,
      new Promise(resolve => {
        timeout = setTimeout(resolve, duration);
        timeout.unref();
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export async function stopChild(child, closed, graceMs = 4000) {
  if (!child?.pid) return;
  if (groupAlive(child.pid)) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
  await waitBounded(closed, graceMs);
  if (groupAlive(child.pid)) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
  await waitBounded(closed, 2000);
  for (let count = 0; count < 20 && groupAlive(child.pid); count += 1)
    await delay(100);
  assert(
    !groupAlive(child.pid),
    `Owned process group ${child.pid} remains active`,
  );
}

export function launch(
  command,
  args,
  { cwd, log, env = process.env, signal } = {},
) {
  const descriptor = fs.openSync(log, 'wx');
  let child;
  try {
    child = spawn(command, args, {
      cwd,
      env,
      detached: true,
      shell: false,
      stdio: ['ignore', descriptor, descriptor],
    });
  } finally {
    fs.closeSync(descriptor);
  }
  let failure;
  const closed = new Promise(resolve => {
    child.once('error', error => {
      failure = error;
      resolve({ code: null, error: error.message });
    });
    child.once('close', (code, exitSignal) =>
      resolve({ code, signal: exitSignal }),
    );
  });
  const abort = () => {
    if (child.pid) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch (error) {
        if (error.code !== 'ESRCH') failure ??= error;
      }
    }
  };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  return {
    child,
    closed,
    log,
    get failure() {
      return failure;
    },
    async stop() {
      try {
        await stopChild(child, closed);
      } finally {
        signal?.removeEventListener('abort', abort);
      }
    },
  };
}

/** Runs one bounded command in its own process group, logging to `log`. */
export async function command(executable, args, options = {}) {
  const handle = launch(executable, args, options);
  let timeout;
  let failure;
  let evidence;
  try {
    const deadline = new Promise((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error(`Command timeout: ${executable}`)),
        options.timeoutMs ?? 300000,
      );
      timeout.unref();
    });
    const result = await Promise.race([handle.closed, deadline]);
    if (handle.failure) throw handle.failure;
    if (result.code !== 0) {
      const tail = fs.existsSync(options.log)
        ? fs.readFileSync(options.log, 'utf8').slice(-2000)
        : '';
      throw new Error(
        `Command failed (${result.code ?? result.signal}): ${executable} ${args.join(' ')}; log ${options.log}\n${tail}`,
      );
    }
    options.signal?.throwIfAborted();
    evidence = {
      command: executable,
      args,
      cwd: options.cwd,
      exitCode: result.code,
      log: sourceEvidence(options.log),
    };
  } catch (error) {
    failure = error;
  } finally {
    clearTimeout(timeout);
  }
  try {
    await handle.stop();
  } catch (error) {
    if (failure)
      throw new AggregateError(
        [failure, error],
        'Command and owned process cleanup failed',
      );
    throw error;
  }
  if (failure) throw failure;
  return evidence;
}
