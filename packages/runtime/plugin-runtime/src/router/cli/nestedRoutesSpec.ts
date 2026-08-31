// @effect-diagnostics asyncFunction:off nodeBuiltinImport:off
import path from 'node:path';
import { fs } from '@modern-js/utils';
import { cloneDeep } from '@modern-js/utils/lodash';

const pendingUpdates = new Map<string, Promise<unknown>>();
let tempFileCounter = 0;

async function writeJSONAtomically(
  filePath: string,
  value: Record<string, unknown>,
) {
  const directory = path.dirname(filePath);
  await fs.ensureDir(directory);
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
      const existingRoutes = (await fs.pathExists(resolvedSpecPath))
        ? ((await fs.readJSON(resolvedSpecPath)) as Record<string, unknown>)
        : {};
      const mergedRoutes = {
        ...existingRoutes,
        ...nextRoutesSnapshot,
      };

      await writeJSONAtomically(resolvedSpecPath, mergedRoutes);
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
