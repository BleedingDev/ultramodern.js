import { normalizeSnapshot } from './resolve';
import type {
  ContractGateSnapshotHttpStoreOptions,
  ContractGateSnapshotStore,
  ContractGateSnapshotStoreUserConfig,
} from './types';
import { CONTRACT_GATE_SNAPSHOT_SCHEMA_VERSION } from './types';

const DEFAULT_HTTP_STORE_TIMEOUT_MS = 5_000;

const BUILTIN_HTTP_STATE_STORE_MODULES = new Set([
  'http',
  // historical aliases kept for config compatibility with the era when these
  // modules lived inside @modern-js/server-core.
  '@modern-js/server-core/http',
  '@modern-js/server-core/contract-gate-http-store',
  '@modern-js/server-runtime-extensions/http',
  '@modern-js/server-runtime-extensions/contract-gate-http-store',
]);

const normalizeHttpStoreOptions = (
  options: Record<string, unknown> | undefined,
): ContractGateSnapshotHttpStoreOptions => {
  const endpoint =
    typeof options?.endpoint === 'string' ? options.endpoint.trim() : '';
  if (!endpoint) {
    throw new Error(
      '[telemetry.health.snapshot] HTTP stateStore requires options.endpoint',
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

export const tryResolveBuiltinSnapshotStore = (input: {
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
