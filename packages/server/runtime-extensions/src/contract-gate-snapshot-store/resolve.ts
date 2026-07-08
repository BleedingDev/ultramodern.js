import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createFileContractGateSnapshotStore } from './file-store';

import { tryResolveBuiltinSnapshotStore } from './http-store';

import type {
  ContractGateSnapshotStore,
  ContractGateSnapshotStoreFactory,
  ContractGateSnapshotStoreFactoryContext,
  ContractGateSnapshotStoreModule,
  ContractGateSnapshotStoreUserConfig,
  GateSnapshot,
  GateSnapshotGateValue,
  LoggerLike,
} from './types';

import { CONTRACT_GATE_SNAPSHOT_SCHEMA_VERSION } from './types';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const normalizeSnapshot = (
  snapshot: unknown,
): GateSnapshot | undefined => {
  if (!isRecord(snapshot)) {
    return undefined;
  }

  const schemaVersion =
    typeof snapshot.schemaVersion === 'number'
      ? snapshot.schemaVersion
      : CONTRACT_GATE_SNAPSHOT_SCHEMA_VERSION;
  const updatedAt =
    typeof snapshot.updatedAt === 'number' ? snapshot.updatedAt : Date.now();
  const gates = isRecord(snapshot.gates)
    ? (snapshot.gates as Record<string, GateSnapshotGateValue>)
    : {};

  return {
    schemaVersion,
    updatedAt,
    gates,
  };
};

const pickStoreFactory = (
  mod: ContractGateSnapshotStoreModule,
): ContractGateSnapshotStoreFactory | undefined => {
  if (typeof mod === 'function') {
    return mod as unknown as ContractGateSnapshotStoreFactory;
  }

  if (typeof mod.createContractGateSnapshotStore === 'function') {
    return mod.createContractGateSnapshotStore;
  }

  if (typeof mod.default === 'function') {
    return mod.default;
  }

  if (
    mod.default &&
    typeof mod.default === 'object' &&
    typeof mod.default.createContractGateSnapshotStore === 'function'
  ) {
    return mod.default.createContractGateSnapshotStore;
  }

  return undefined;
};

const ensureStoreShape = (
  store: ContractGateSnapshotStore,
  modulePath: string,
) => {
  if (
    !store ||
    typeof store !== 'object' ||
    typeof store.readSnapshot !== 'function' ||
    typeof store.writeSnapshot !== 'function'
  ) {
    throw new Error(
      `Invalid contract gate snapshot store from "${modulePath}". Expected { readSnapshot(), writeSnapshot() }.`,
    );
  }
};

/**
 * Resolves a user-configured stateStore module specifier from the app, not
 * from this framework package: relative paths resolve against appDirectory,
 * and bare package specifiers resolve through the app's own module graph
 * (`createRequire` anchored at the app package.json). Resolving from the
 * framework package breaks app-installed stores under pnpm's strict
 * node_modules layout. Bare specifiers fall back to framework-local
 * resolution for stores installed alongside the framework.
 */
const resolveStoreModulePath = (appDirectory: string, modulePath: string) => {
  const normalized = modulePath.trim();
  if (!normalized) {
    throw new Error(
      'Contract gate snapshot stateStore.module must be non-empty',
    );
  }

  if (path.isAbsolute(normalized)) {
    return normalized;
  }

  if (normalized.startsWith('.')) {
    return path.resolve(appDirectory, normalized);
  }

  const appRequire = createRequire(path.join(appDirectory, 'package.json'));
  try {
    return appRequire.resolve(normalized);
  } catch (_error) {
    // Fall back to this package's own resolution so stores installed next to
    // the framework keep working.
    return normalized;
  }
};

const toStoreModuleImportSpecifier = (modulePath: string) =>
  path.isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath;

export const resolveContractGateSnapshotStore = async (input: {
  appDirectory: string;
  gateSnapshotPath: string;
  stateStore?: ContractGateSnapshotStoreUserConfig;
  logger?: LoggerLike;
}): Promise<ContractGateSnapshotStore> => {
  const { appDirectory, gateSnapshotPath, stateStore, logger } = input;

  if (!stateStore?.module) {
    return createFileContractGateSnapshotStore(gateSnapshotPath);
  }

  const builtinStore = tryResolveBuiltinSnapshotStore({ stateStore });
  if (builtinStore) {
    logger?.info?.(
      `[telemetry.canary.autopilot] using built-in contract gate snapshot store "${builtinStore.name}"`,
    );
    return builtinStore;
  }

  const modulePath = resolveStoreModulePath(appDirectory, stateStore.module);
  let mod: ContractGateSnapshotStoreModule;
  try {
    mod = (await import(
      toStoreModuleImportSpecifier(modulePath)
    )) as ContractGateSnapshotStoreModule;
  } catch (error) {
    throw new Error(
      `[telemetry.canary.autopilot] Failed to load stateStore.module "${stateStore.module}" (${modulePath}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const factory = pickStoreFactory(mod);
  if (!factory) {
    throw new Error(
      `[telemetry.canary.autopilot] stateStore.module "${stateStore.module}" does not export createContractGateSnapshotStore()`,
    );
  }

  const store = await factory({
    appDirectory,
    gateSnapshotPath,
    options: stateStore.options,
    logger,
  });
  ensureStoreShape(store, modulePath);
  logger?.info?.(
    `[telemetry.canary.autopilot] using contract gate snapshot store "${store.name || modulePath}"`,
  );
  return store;
};
