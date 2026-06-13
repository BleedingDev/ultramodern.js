import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type ReleaseFixtureLock = () => Promise<void>;

const pollInterval = 200;
const staleLockAge = 10 * 60 * 1000;
const heartbeatInterval = 30 * 1000;

function resolveLockDir(fixtureDir: string) {
  const realPath = path.resolve(fixtureDir);
  const digest = crypto.createHash('sha1').update(realPath).digest('hex');

  return path.join(os.tmpdir(), `modernjs-fixture-${digest}.lock`);
}

function isProcessAlive(pid: unknown) {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function readLockOwner(lockDir: string) {
  try {
    const rawOwner = await fs.readFile(
      path.join(lockDir, 'owner.json'),
      'utf8',
    );
    return JSON.parse(rawOwner) as {
      pid?: unknown;
    };
  } catch {
    return undefined;
  }
}

async function isStaleLock(lockDir: string) {
  const owner = await readLockOwner(lockDir);
  if (owner && isProcessAlive(owner.pid)) {
    return false;
  }

  const stat = await fs.stat(lockDir);
  return Date.now() - stat.mtimeMs > staleLockAge;
}

export async function acquireFixtureLock(
  fixtureDir: string,
): Promise<ReleaseFixtureLock> {
  const lockDir = resolveLockDir(fixtureDir);

  while (true) {
    try {
      await fs.mkdir(lockDir);
      const ownerPath = path.join(lockDir, 'owner.json');
      await fs.writeFile(
        ownerPath,
        JSON.stringify({
          pid: process.pid,
          fixtureDir: path.resolve(fixtureDir),
          acquiredAt: new Date().toISOString(),
        }),
      );
      const heartbeat = setInterval(() => {
        void fs.utimes(ownerPath, new Date(), new Date()).catch(() => {});
      }, heartbeatInterval);
      heartbeat.unref();

      return async () => {
        clearInterval(heartbeat);
        await fs.rm(lockDir, { recursive: true, force: true });
      };
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }

      try {
        if (await isStaleLock(lockDir)) {
          await fs.rm(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }
}

export async function acquireFixtureLocks(
  fixtureDirs: string[],
): Promise<ReleaseFixtureLock> {
  const releaseLocks: ReleaseFixtureLock[] = [];
  const sortedFixtureDirs = [
    ...new Set(fixtureDirs.map(dir => path.resolve(dir))),
  ].sort();

  try {
    for (const fixtureDir of sortedFixtureDirs) {
      releaseLocks.push(await acquireFixtureLock(fixtureDir));
    }
  } catch (error) {
    await Promise.allSettled(releaseLocks.reverse().map(release => release()));
    throw error;
  }

  return async () => {
    await Promise.allSettled(releaseLocks.reverse().map(release => release()));
  };
}
