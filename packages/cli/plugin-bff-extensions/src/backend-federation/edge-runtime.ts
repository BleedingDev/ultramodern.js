import type { BackendFederationExpectedIdentity } from './identity';
import type { BackendFederationEntryExports } from './types';
import { validateLoadedBackendFederatedEffectApi } from './validate-loaded';

export type BackendFederationEdgeLoadEntryPlugin = {
  name: string;
  loadEntry: (args: {
    remoteInfo: BackendFederationEdgeRemote;
  }) =>
    | BackendFederationEntryExports
    | undefined
    | Promise<BackendFederationEntryExports | undefined>;
};

export type BackendFederationEdgeLoadEntryPluginOptions = {
  /**
   * Resolve the fork-owned edge entry contract, not a raw Module Federation
   * container. The edge runtime calls its optional `init` once per remote with
   * `{ hostName }`, then caches each loaded expose.
   */
  resolveEntry: (
    remote: BackendFederationEdgeRemote,
  ) =>
    | BackendFederationEntryExports
    | undefined
    | Promise<BackendFederationEntryExports | undefined>;
};

export type BackendFederationEdgeRemote = {
  entry: `${'binding' | 'service' | 'static'}:${string}`;
  entryGlobalName?: string;
  expose?: string;
  name: string;
  shareScope?: string | string[];
  type?: 'commonjs-module' | 'module' | string;
  verification?: never;
};

type BackendFederationEdgeRuntimeBaseOptions = {
  entryPolicy?: never;
  hostName: string;
  plugins?: BackendFederationEdgeLoadEntryPlugin[];
  remote?: BackendFederationEdgeRemote;
  remotes?: BackendFederationEdgeRemote[];
};

export type BackendFederationEdgeRuntimeOptions =
  BackendFederationEdgeRuntimeBaseOptions & {
    expected: BackendFederationExpectedIdentity;
  };

type EdgeRuntimeLoadOptions = BackendFederationEdgeRuntimeBaseOptions & {
  allowMissingIdentityMetadata?: boolean;
  expected?: BackendFederationExpectedIdentity;
};

function parseRemoteRequest(request: string) {
  const separator = request.indexOf('/');
  if (separator <= 0 || separator === request.length - 1) {
    throw new Error(
      `[BFF][Effect] Invalid backend federation request ${request}.`,
    );
  }
  return {
    expose: `./${request.slice(separator + 1).replace(/^\.\//u, '')}`,
    remoteName: request.slice(0, separator),
  };
}

function requireEdgeRemote(
  remotes: readonly BackendFederationEdgeRemote[],
  remoteName: string,
) {
  const remote = remotes.find(candidate => candidate.name === remoteName);
  if (remote === undefined) {
    throw new Error(
      `[BFF][Effect] Missing backend federation remote ${remoteName}.`,
    );
  }
  if (!/^(?:binding|service|static):/u.test(remote.entry)) {
    throw new Error(
      `[BFF][Effect] Edge backend federation remote ${remote.name} must use static or service-binding entries.`,
    );
  }
  return remote;
}

async function resolveEdgeEntry(
  plugins: readonly BackendFederationEdgeLoadEntryPlugin[],
  remote: BackendFederationEdgeRemote,
) {
  for (const plugin of plugins) {
    const entry = await plugin.loadEntry?.({ remoteInfo: remote });
    if (entry !== undefined) {
      return entry;
    }
  }
  if (remote.entry.startsWith('static:') && remote.entryGlobalName) {
    const globalEntry = (globalThis as Record<string, unknown>)[
      remote.entryGlobalName
    ];
    if (typeof globalEntry === 'object' && globalEntry !== null) {
      return globalEntry as BackendFederationEntryExports;
    }
    throw new Error(
      `[BFF][Effect] Missing static backend federation entry global ${remote.entryGlobalName} for remote ${remote.name}.`,
    );
  }
  throw new Error(
    `[BFF][Effect] Missing static or service-binding entry provider for backend federation remote ${remote.name}.`,
  );
}

class EdgeBackendFederationRuntime {
  readonly #entries = new Map<string, Promise<BackendFederationEntryExports>>();
  readonly #expected: BackendFederationExpectedIdentity | undefined;
  readonly #hostName: string;
  readonly #allowMissingIdentityMetadata: boolean;
  readonly #modules = new Map<string, Promise<unknown>>();
  readonly #plugins: readonly BackendFederationEdgeLoadEntryPlugin[];
  readonly #remotes: BackendFederationEdgeRemote[];

  constructor(options: EdgeRuntimeLoadOptions) {
    if (options.entryPolicy !== undefined) {
      throw new Error(
        '[BFF][Effect] Edge backend federation does not execute entry evaluators. Register a static or service-binding entry provider.',
      );
    }
    this.#allowMissingIdentityMetadata =
      options.allowMissingIdentityMetadata === true;
    this.#expected = options.expected;
    this.#hostName = options.hostName;
    this.#plugins = options.plugins ?? [];
    this.#remotes = [...(options.remotes ?? [])];
    const configuredRemote = options.remote;
    if (configuredRemote !== undefined) {
      const existingIndex = this.#remotes.findIndex(
        remote => remote.name === configuredRemote.name,
      );
      if (existingIndex >= 0) {
        this.#remotes[existingIndex] = configuredRemote;
      } else {
        this.#remotes.push(configuredRemote);
      }
    }
  }

  #loadEntry(remote: BackendFederationEdgeRemote) {
    const existing = this.#entries.get(remote.name);
    if (existing !== undefined) {
      return existing;
    }
    const loading = resolveEdgeEntry(this.#plugins, remote).then(
      async entry => {
        await entry.init?.({ hostName: this.#hostName });
        return entry;
      },
    );
    this.#entries.set(remote.name, loading);
    loading.catch(() => {
      if (this.#entries.get(remote.name) === loading) {
        this.#entries.delete(remote.name);
      }
    });
    return loading;
  }

  #loadModule(request: string) {
    const { expose, remoteName } = parseRemoteRequest(request);
    const remote = requireEdgeRemote(this.#remotes, remoteName);
    return this.#loadEntry(remote).then(async entry => {
      if (typeof entry.get !== 'function') {
        throw new Error(
          `[BFF][Effect] Backend federation remote ${remote.name} entry must expose get().`,
        );
      }
      const factory = await entry.get(expose);
      if (typeof factory !== 'function') {
        throw new Error(
          `[BFF][Effect] Backend federation expose ${remote.name}/${expose.replace(/^\.\//u, '')} must load factory function.`,
        );
      }
      const loaded = await factory();
      return validateLoadedBackendFederatedEffectApi(loaded, {
        allowMissingIdentityMetadata: this.#allowMissingIdentityMetadata,
        expected: this.#expected,
        remoteName,
        remoteRequest: request,
      });
    });
  }

  async loadRemote<T>(request: string): Promise<T> {
    const existing = this.#modules.get(request);
    if (existing !== undefined) {
      return existing as Promise<T>;
    }
    const loading = this.#loadModule(request);
    this.#modules.set(request, loading);
    loading.catch(() => {
      if (this.#modules.get(request) === loading) {
        this.#modules.delete(request);
      }
    });
    return loading as Promise<T>;
  }
}

export type BackendFederationEdgeRuntime = {
  loadRemote<T>(request: string): Promise<T>;
};

export function createBackendFederationLoadEntryPlugin(
  options: BackendFederationEdgeLoadEntryPluginOptions,
): BackendFederationEdgeLoadEntryPlugin {
  return {
    name: 'modernjs-backend-federation-load-entry',
    loadEntry({ remoteInfo }) {
      return Promise.resolve(options.resolveEntry(remoteInfo)).then(entry => {
        if (entry === undefined) {
          return;
        }
        return {
          get(id: string) {
            return () =>
              Promise.resolve(entry.get(id)).then(factory => factory());
          },
          init(...args: unknown[]) {
            return entry.init?.(...args);
          },
        };
      });
    },
  };
}

export function createBackendFederationRuntime(
  options: BackendFederationEdgeRuntimeOptions,
): BackendFederationEdgeRuntime {
  if (
    options.expected === undefined ||
    typeof options.expected.unitId !== 'string' ||
    options.expected.unitId.length === 0 ||
    typeof options.expected.buildMarker !== 'string' ||
    options.expected.buildMarker.length === 0
  ) {
    throw new Error(
      '[BFF][Effect] Edge backend federation runtime requires expected.unitId and expected.buildMarker.',
    );
  }
  return new EdgeBackendFederationRuntime(options);
}

export function createBackendFederationRuntimeForLoad(
  options: EdgeRuntimeLoadOptions,
): BackendFederationEdgeRuntime {
  return new EdgeBackendFederationRuntime(options);
}
