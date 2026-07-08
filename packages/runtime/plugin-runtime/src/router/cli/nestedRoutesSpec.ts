// @effect-diagnostics asyncFunction:off nodeBuiltinImport:off
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fs } from '@modern-js/utils';
import { cloneDeep } from '@modern-js/utils/lodash';

const lockPollIntervalMs = 25;
const staleLockAgeMs = 2 * 60 * 1000;

const pendingUpdates = new Map<string, Promise<unknown>>();
let tempFileCounter = 0;

async function acquireSpecLock(specPath: string) {
  const lockDir = `${specPath}.lock`;
  await fs.ensureDir(path.dirname(specPath));

  while (true) {
    try {
      await fs.mkdir(lockDir);

      return async () => {
        await fs.remove(lockDir);
      };
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }

    try {
      const stat = await fs.stat(lockDir);
      if (
        performance.timeOrigin + performance.now() - stat.mtimeMs >
        staleLockAgeMs
      ) {
        await fs.remove(lockDir);
        continue;
      }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      continue;
    }

    await sleep(lockPollIntervalMs);
  }
}

async function writeJSONAtomically(
  filePath: string,
  value: Record<string, unknown>,
) {
  const directory = path.dirname(filePath);
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${(tempFileCounter += 1)}.tmp`,
  );

  try {
    await fs.writeFile(tempPath, `${JSON.stringify(value)}\n`);
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.remove(tempPath).catch(() => {});
    throw error;
  }
}

export async function updateNestedRoutesSpec(
  specPath: string,
  nextRoutes: Record<string, unknown>,
) {
  const resolvedSpecPath = path.resolve(specPath);
  const nextRoutesSnapshot = cloneDeep(nextRoutes);
  const previousUpdate =
    pendingUpdates.get(resolvedSpecPath) ?? Promise.resolve();
  const currentUpdate = previousUpdate
    .catch(() => undefined)
    .then(async () => {
      const releaseLock = await acquireSpecLock(resolvedSpecPath);

      try {
        const existingRoutes = (await fs.pathExists(resolvedSpecPath))
          ? ((await fs.readJSON(resolvedSpecPath)) as Record<string, unknown>)
          : {};

        await writeJSONAtomically(resolvedSpecPath, {
          ...existingRoutes,
          ...nextRoutesSnapshot,
        });
      } finally {
        await releaseLock();
      }
    });

  pendingUpdates.set(resolvedSpecPath, currentUpdate);

  try {
    await currentUpdate;
  } finally {
    if (pendingUpdates.get(resolvedSpecPath) === currentUpdate) {
      pendingUpdates.delete(resolvedSpecPath);
    }
  }
}
