import { promises as nodeFs } from 'node:fs';
import path from 'node:path';
import { fs } from '@modern-js/utils';

import { parseServerRuntimeExtensionsEnv } from '../env';

import { normalizeSnapshot } from './resolve';

import type { ContractGateSnapshotStore } from './types';

import {
  CONTRACT_GATE_SNAPSHOT_SCHEMA_VERSION,
  DEFAULT_CONTRACT_GATE_SNAPSHOT_PATH,
} from './types';

export const resolveContractGateSnapshotPath = (
  appDirectory: string,
  configuredPath: string | undefined,
) => {
  const rawPath =
    configuredPath ||
    parseServerRuntimeExtensionsEnv().contractGatesFile ||
    DEFAULT_CONTRACT_GATE_SNAPSHOT_PATH;
  if (path.isAbsolute(rawPath)) {
    return rawPath;
  }
  return path.resolve(appDirectory, rawPath);
};

const writeSnapshotFileAtomically = async (
  resolvedPath: string,
  contents: string,
) => {
  const directory = path.dirname(resolvedPath);
  await nodeFs.mkdir(directory, { recursive: true });

  const temporaryPath = path.join(
    directory,
    `.${path.basename(resolvedPath)}.${process.pid}.${Date.now()}.${Math.random()
      .toString(36)
      .slice(2)}.tmp`,
  );

  try {
    await nodeFs.writeFile(temporaryPath, contents);
    await nodeFs.rename(temporaryPath, resolvedPath);
  } catch (error) {
    await nodeFs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
};

export const createFileContractGateSnapshotStore = (
  gateSnapshotPath: string,
): ContractGateSnapshotStore => {
  const resolvedPath = path.resolve(gateSnapshotPath);
  return {
    name: `file:${resolvedPath}`,
    async readSnapshot() {
      if (!(await fs.pathExists(resolvedPath))) {
        return undefined;
      }

      try {
        const raw = await nodeFs.readFile(resolvedPath, 'utf8');
        return normalizeSnapshot(JSON.parse(raw));
      } catch (_error) {
        return undefined;
      }
    },
    async writeSnapshot(snapshot) {
      const normalized = normalizeSnapshot(snapshot) || {
        schemaVersion: CONTRACT_GATE_SNAPSHOT_SCHEMA_VERSION,
        updatedAt: Date.now(),
        gates: {},
      };
      await writeSnapshotFileAtomically(
        resolvedPath,
        `${JSON.stringify(normalized, null, 2)}\n`,
      );
    },
  };
};
