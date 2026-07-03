import type {
  ModuleFederation,
  ModuleFederationRuntimePlugin,
} from '@module-federation/runtime';

import type { EffectApiModule } from './module';

export const BACKEND_FEDERATION_EFFECT_EXPOSE = './effect-api';
export const BACKEND_FEDERATION_MANIFEST_FILE = 'backend-mf-manifest.json';
export const BACKEND_FEDERATION_CONTRACT_VERSION =
  'microvertical-server-effect-v1';
export const BACKEND_FEDERATION_NODE_ADAPTER_VERSION = 'backend-mf-effect-v1';

export type BackendFederationRemote = {
  name: string;
  entry: string;
  type?: 'commonjs-module' | 'module' | string;
  entryGlobalName?: string;
  shareScope?: string | string[];
  expose?: typeof BACKEND_FEDERATION_EFFECT_EXPOSE;
};

export type BackendFederationRuntimeOptions = {
  hostName: string;
  remote?: BackendFederationRemote;
  remotes?: BackendFederationRemote[];
  plugins?: ModuleFederationRuntimePlugin[];
};

export type BackendFederationEntryExports = {
  get: (
    id: string,
  ) =>
    | (() => Promise<unknown> | unknown)
    | Promise<() => Promise<unknown> | unknown>;
  init?: (...args: unknown[]) => void | Promise<void>;
};

export type BackendFederatedEffectApiModule = EffectApiModule & {
  backendFederationContract?: {
    compatibility?: {
      build?: unknown;
      contractVersion?: unknown;
      nodeAdapterVersion?: unknown;
      packageName?: unknown;
    };
    name?: unknown;
    role?: unknown;
    runtimeFramework?: unknown;
    strictEffectApproach?: unknown;
  };
  contract?: unknown;
  operationContexts?: unknown;
  runtime?: unknown;
};

export type BackendFederationLoadEntryPluginOptions = {
  resolveEntry: (
    remote: BackendFederationRemote,
  ) =>
    | BackendFederationEntryExports
    | undefined
    | Promise<BackendFederationEntryExports | undefined>;
};

type BackendFederationLoadOptions = BackendFederationRuntimeOptions & {
  runtime?: ModuleFederation;
  remoteName?: string;
  expose?: string;
};

type BackendFederationLoadEntryPlugin = ModuleFederationRuntimePlugin & {
  loadEntry?: (args: {
    remoteInfo: BackendFederationRemote;
  }) =>
    | BackendFederationEntryExports
    | undefined
    | Promise<BackendFederationEntryExports | undefined>;
};

function normalizeExpose(expose: string) {
  return expose.replace(/^\.\//u, '');
}

function exposeForRemoteRequest(expose: string) {
  return `./${normalizeExpose(expose)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function collectRemotes(options: BackendFederationRuntimeOptions) {
  const remotes = [...(options.remotes ?? [])];
  if (options.remote) {
    const existingIndex = remotes.findIndex(
      remote => remote.name === options.remote?.name,
    );
    if (existingIndex >= 0) {
      remotes[existingIndex] = options.remote;
    } else {
      remotes.push(options.remote);
    }
  }
  return remotes;
}

function parseRemoteRequest(request: string) {
  const [remoteName, ...exposeParts] = request.split('/');
  if (!remoteName || exposeParts.length === 0) {
    throw new Error(
      `[BFF][Effect] Invalid backend federation request ${request}.`,
    );
  }
  return {
    remoteName,
    expose: exposeForRemoteRequest(exposeParts.join('/')),
  };
}

function decodeDataUrl(url: string) {
  const commaIndex = url.indexOf(',');
  if (commaIndex < 0) {
    throw new Error('[BFF][Effect] Invalid backend federation data URL entry.');
  }
  return decodeURIComponent(url.slice(commaIndex + 1));
}

async function readCommonJsEntrySource(remote: BackendFederationRemote) {
  if (remote.entry.startsWith('data:')) {
    return decodeDataUrl(remote.entry);
  }

  if (
    remote.entry.startsWith('http://') ||
    remote.entry.startsWith('https://')
  ) {
    const response = await fetch(remote.entry);
    if (!response.ok) {
      throw new Error(
        `[BFF][Effect] Failed to load backend federation remote ${remote.name}: ${response.status}`,
      );
    }
    return response.text();
  }

  throw new Error(
    `[BFF][Effect] Backend federation remote ${remote.name} cannot load CommonJS entry ${remote.entry}.`,
  );
}

function evaluateCommonJsEntry(
  remote: BackendFederationRemote,
  source: string,
) {
  const module = { exports: {} as Record<string, unknown> };
  const exports = module.exports;
  const evaluate = new Function('module', 'exports', 'globalThis', source);
  evaluate(module, exports, globalThis);

  const entry = module.exports.default ?? module.exports;
  if (!isRecord(entry)) {
    throw new Error(
      `[BFF][Effect] Backend federation remote ${remote.name} entry must load object module.`,
    );
  }
  return entry as unknown as BackendFederationEntryExports;
}

async function importModuleEntry(remote: BackendFederationRemote) {
  const entry = await import(/* webpackIgnore: true */ remote.entry);
  return (entry.default ?? entry) as BackendFederationEntryExports;
}

async function resolvePluginEntry(
  remote: BackendFederationRemote,
  plugins: ModuleFederationRuntimePlugin[] | undefined,
) {
  for (const plugin of plugins ?? []) {
    const loadEntry = (plugin as BackendFederationLoadEntryPlugin).loadEntry;
    if (typeof loadEntry !== 'function') {
      continue;
    }
    const entry = await loadEntry({ remoteInfo: remote });
    if (entry) {
      return entry;
    }
  }
}

async function loadBackendFederationEntry(
  remote: BackendFederationRemote,
  plugins: ModuleFederationRuntimePlugin[] | undefined,
) {
  const pluginEntry = await resolvePluginEntry(remote, plugins);
  if (pluginEntry) {
    return pluginEntry;
  }

  if (remote.entryGlobalName) {
    const globalEntry = (globalThis as Record<string, unknown>)[
      remote.entryGlobalName
    ];
    if (isRecord(globalEntry)) {
      return globalEntry as unknown as BackendFederationEntryExports;
    }
  }

  if (remote.type === 'module' || remote.entry.startsWith('file:')) {
    return importModuleEntry(remote);
  }

  return evaluateCommonJsEntry(remote, await readCommonJsEntrySource(remote));
}

async function loadBackendFederationExpose(
  remote: BackendFederationRemote,
  expose: string,
  options: BackendFederationRuntimeOptions,
) {
  const entry = await loadBackendFederationEntry(remote, options.plugins);
  if (typeof entry.init === 'function') {
    await entry.init({ hostName: options.hostName });
  }
  if (typeof entry.get !== 'function') {
    throw new Error(
      `[BFF][Effect] Backend federation remote ${remote.name} entry must expose get().`,
    );
  }
  const factory = await entry.get(expose);
  if (typeof factory !== 'function') {
    throw new Error(
      `[BFF][Effect] Backend federation expose ${remote.name}/${normalizeExpose(
        expose,
      )} must load factory function.`,
    );
  }
  return factory();
}

export function createBackendFederationRuntime(
  options: BackendFederationRuntimeOptions,
): ModuleFederation {
  const remotes = collectRemotes(options);

  return {
    async loadRemote<T>(request: string): Promise<T> {
      const { remoteName, expose } = parseRemoteRequest(request);
      const remote = remotes.find(candidate => candidate.name === remoteName);
      if (!remote) {
        throw new Error(
          `[BFF][Effect] Missing backend federation remote ${remoteName}.`,
        );
      }
      return loadBackendFederationExpose(remote, expose, options) as Promise<T>;
    },
  } as ModuleFederation;
}

export function createBackendFederationLoadEntryPlugin(
  options: BackendFederationLoadEntryPluginOptions,
): ModuleFederationRuntimePlugin {
  return {
    name: 'modernjs-backend-federation-load-entry',
    async loadEntry({ remoteInfo }) {
      return options.resolveEntry({
        name: remoteInfo.name,
        entry: remoteInfo.entry,
        type: remoteInfo.type,
        entryGlobalName: remoteInfo.entryGlobalName,
        shareScope: remoteInfo.shareScope,
      });
    },
  } as ModuleFederationRuntimePlugin;
}

export async function loadBackendFederatedEffectApi(
  options: BackendFederationLoadOptions,
): Promise<BackendFederatedEffectApiModule> {
  const remoteName = options.remote?.name ?? options.remoteName;
  if (!remoteName) {
    throw new Error('[BFF][Effect] Missing backend federation remote name.');
  }

  const runtime = options.runtime ?? createBackendFederationRuntime(options);
  const expose =
    options.expose ??
    options.remote?.expose ??
    BACKEND_FEDERATION_EFFECT_EXPOSE;
  const remoteRequest = `${remoteName}/${normalizeExpose(expose)}`;
  const loaded =
    await runtime.loadRemote<BackendFederatedEffectApiModule>(remoteRequest);

  if (!isRecord(loaded)) {
    throw new Error(
      `[BFF][Effect] Backend federation expose ${remoteRequest} must load an object module.`,
    );
  }

  const backendContract = loaded.backendFederationContract;
  if (
    !isRecord(backendContract) ||
    backendContract.strictEffectApproach !== true
  ) {
    throw new Error(
      `[BFF][Effect] Backend federation expose ${remoteRequest} must expose strict Effect metadata (strictEffectApproach: true).`,
    );
  }

  if (backendContract.runtimeFramework !== 'effect') {
    throw new Error(
      `[BFF][Effect] Backend federation expose ${remoteRequest} must expose strict Effect metadata (runtimeFramework: "effect").`,
    );
  }

  if (
    typeof backendContract.name === 'string' &&
    backendContract.name !== remoteName
  ) {
    throw new Error(
      `[BFF][Effect] Backend federation expose ${remoteRequest} metadata name mismatch: expected ${remoteName}, received ${backendContract.name}.`,
    );
  }

  if (!('runtime' in loaded)) {
    throw new Error(
      `[BFF][Effect] Backend federation expose ${remoteRequest} must expose api and runtime.`,
    );
  }

  return loaded as BackendFederatedEffectApiModule;
}
