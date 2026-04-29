import { fs } from '@modern-js/utils';
import { promises as nodeFs } from 'fs';
import path from 'path';

export const CONTRACT_GATE_SNAPSHOT_SCHEMA_VERSION = 1;
export const DEFAULT_CONTRACT_GATE_SNAPSHOT_PATH =
  '.modern/contract-gates.json';

export type GateSnapshotGateValue =
  | boolean
  | {
      passed?: boolean;
      reason?: string;
      updatedAt?: number;
      expiresAt?: number;
      [key: string]: unknown;
    };

export type GateSnapshot = {
  schemaVersion?: number;
  updatedAt?: number;
  gates?: Record<string, GateSnapshotGateValue>;
};

type LoggerLike = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

export type ContractGateSnapshotStore = {
  name: string;
  readSnapshot: () => Promise<GateSnapshot | undefined>;
  writeSnapshot: (snapshot: GateSnapshot) => Promise<void>;
};

export type ContractGateSnapshotStoreFactoryContext = {
  appDirectory: string;
  gateSnapshotPath: string;
  options?: Record<string, unknown>;
  logger?: LoggerLike;
};

export type ContractGateSnapshotStoreFactory = (
  context: ContractGateSnapshotStoreFactoryContext,
) => Promise<ContractGateSnapshotStore> | ContractGateSnapshotStore;

export type ContractGateSnapshotStoreModule = {
  createContractGateSnapshotStore?: ContractGateSnapshotStoreFactory;
  default?:
    | ContractGateSnapshotStoreFactory
    | {
        createContractGateSnapshotStore?: ContractGateSnapshotStoreFactory;
      };
};

export type ContractGateSnapshotStoreUserConfig = {
  module: string;
  options?: Record<string, unknown>;
};

export type ContractGateSnapshotHttpStoreOptions = {
  endpoint: string;
  readMethod?: string;
  writeMethod?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
};

const DEFAULT_HTTP_STORE_TIMEOUT_MS = 5_000;
const BUILTIN_HTTP_STATE_STORE_MODULES = new Set([
  'http',
  '@modern-js/server-core/http',
  '@modern-js/server-core/contract-gate-http-store',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeSnapshot = (snapshot: unknown): GateSnapshot | undefined => {
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

const normalizeHttpStoreOptions = (
  options: Record<string, unknown> | undefined,
): ContractGateSnapshotHttpStoreOptions => {
  const endpoint =
    typeof options?.endpoint === 'string' ? options.endpoint.trim() : '';
  if (!endpoint) {
    throw new Error(
      '[telemetry.canary.autopilot] HTTP stateStore requires options.endpoint',
    );
  }

  const readMethod =
    typeof options?.readMethod === 'string' && options.readMethod.trim()
      ? options.readMethod.trim().toUpperCase()
      : 'GET';
  const writeMethod =
    typeof options?.writeMethod === 'string' && options.writeMethod.trim()
      ? options.writeMethod.trim().toUpperCase()
      : 'PUT';

  const timeoutMsRaw = Number(options?.timeoutMs);
  const timeoutMs =
    Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0
      ? Math.floor(timeoutMsRaw)
      : DEFAULT_HTTP_STORE_TIMEOUT_MS;

  const headersRaw = options?.headers;
  const headers: Record<string, string> = {};
  if (
    headersRaw &&
    typeof headersRaw === 'object' &&
    !Array.isArray(headersRaw)
  ) {
    Object.entries(headersRaw).forEach(([key, value]) => {
      if (typeof key === 'string' && key.trim().length > 0 && value != null) {
        headers[key] = String(value);
      }
    });
  }

  return {
    endpoint,
    readMethod,
    writeMethod,
    headers,
    timeoutMs,
  };
};

const withTimeoutAbort = (timeoutMs: number) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
};

export const createHttpContractGateSnapshotStore = (
  options: ContractGateSnapshotHttpStoreOptions,
): ContractGateSnapshotStore => {
  const normalized = normalizeHttpStoreOptions(
    options as unknown as Record<string, unknown>,
  );
  const endpoint = normalized.endpoint;

  return {
    name: `http:${endpoint}`,
    async readSnapshot() {
      const { signal, clear } = withTimeoutAbort(normalized.timeoutMs || 5_000);
      try {
        const response = await fetch(endpoint, {
          method: normalized.readMethod || 'GET',
          headers: {
            accept: 'application/json',
            ...(normalized.headers || {}),
          },
          signal,
        });

        if (response.status === 404) {
          return undefined;
        }

        if (!response.ok) {
          throw new Error(
            `HTTP stateStore read failed with status ${String(response.status)}`,
          );
        }

        const payload = await response.json();
        return normalizeSnapshot(payload);
      } finally {
        clear();
      }
    },
    async writeSnapshot(snapshot) {
      const body = JSON.stringify(
        normalizeSnapshot(snapshot) || {
          schemaVersion: CONTRACT_GATE_SNAPSHOT_SCHEMA_VERSION,
          updatedAt: Date.now(),
          gates: {},
        },
      );
      const { signal, clear } = withTimeoutAbort(normalized.timeoutMs || 5_000);
      try {
        const response = await fetch(endpoint, {
          method: normalized.writeMethod || 'PUT',
          headers: {
            'content-type': 'application/json',
            ...(normalized.headers || {}),
          },
          body,
          signal,
        });
        if (!response.ok) {
          throw new Error(
            `HTTP stateStore write failed with status ${String(response.status)}`,
          );
        }
      } finally {
        clear();
      }
    },
  };
};

const tryResolveBuiltinSnapshotStore = (input: {
  stateStore: ContractGateSnapshotStoreUserConfig;
}): ContractGateSnapshotStore | undefined => {
  const moduleName = input.stateStore.module.trim();
  if (!BUILTIN_HTTP_STATE_STORE_MODULES.has(moduleName)) {
    return undefined;
  }

  return createHttpContractGateSnapshotStore(
    (input.stateStore.options || {}) as ContractGateSnapshotHttpStoreOptions,
  );
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

  return normalized.startsWith('.')
    ? path.resolve(appDirectory, normalized)
    : normalized;
};

export const resolveContractGateSnapshotPath = (
  appDirectory: string,
  configuredPath: string | undefined,
) => {
  const rawPath =
    configuredPath ||
    process.env.MODERN_CONTRACT_GATES_FILE ||
    DEFAULT_CONTRACT_GATE_SNAPSHOT_PATH;
  if (path.isAbsolute(rawPath)) {
    return rawPath;
  }
  return path.resolve(appDirectory, rawPath);
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
      await nodeFs.mkdir(path.dirname(resolvedPath), { recursive: true });
      await nodeFs.writeFile(
        resolvedPath,
        `${JSON.stringify(normalized, null, 2)}\n`,
      );
    },
  };
};

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
    // eslint-disable-next-line import/no-dynamic-require,global-require
    mod = require(modulePath) as ContractGateSnapshotStoreModule;
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
