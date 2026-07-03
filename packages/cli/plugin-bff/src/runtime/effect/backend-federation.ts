import {
  createInstance,
  type ModuleFederation,
  type ModuleFederationRuntimePlugin,
} from '@module-federation/runtime';

import type { EffectApiModule } from './module';

export const BACKEND_FEDERATION_EFFECT_EXPOSE = './effect-api';

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
  remote: BackendFederationRemote;
  plugins?: ModuleFederationRuntimePlugin[];
};

export type BackendFederationEntryExports = {
  get: (id: string) => () => Promise<unknown>;
  init: (...args: unknown[]) => void | Promise<void>;
};

export type BackendFederatedEffectApiModule = EffectApiModule & {
  backendFederationContract?: {
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

function normalizeExpose(expose: string) {
  return expose.replace(/^\.\//u, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function createBackendFederationFileEntryPlugin(): ModuleFederationRuntimePlugin {
  return {
    name: 'modernjs-backend-federation-file-entry',
    async loadEntry({ remoteInfo }) {
      if (!remoteInfo.entry.startsWith('file:')) {
        return;
      }

      const entry = await import(/* webpackIgnore: true */ remoteInfo.entry);
      return entry.default ?? entry;
    },
  };
}

export function createBackendFederationRuntime(
  options: BackendFederationRuntimeOptions,
): ModuleFederation {
  const { remote } = options;

  return createInstance({
    name: options.hostName,
    plugins: [
      ...(options.plugins ?? []),
      createBackendFederationFileEntryPlugin(),
    ],
    remotes: [
      {
        name: remote.name,
        entry: remote.entry,
        type: remote.type ?? 'commonjs-module',
        ...(remote.entryGlobalName
          ? { entryGlobalName: remote.entryGlobalName }
          : {}),
        ...(remote.shareScope ? { shareScope: remote.shareScope } : {}),
      },
    ],
  });
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
  };
}

export async function loadBackendFederatedEffectApi(
  options: BackendFederationRuntimeOptions & {
    runtime?: ModuleFederation;
  },
): Promise<BackendFederatedEffectApiModule> {
  const runtime = options.runtime ?? createBackendFederationRuntime(options);
  const expose = options.remote.expose ?? BACKEND_FEDERATION_EFFECT_EXPOSE;
  const remoteRequest = `${options.remote.name}/${normalizeExpose(expose)}`;
  const loaded =
    await runtime.loadRemote<BackendFederatedEffectApiModule>(remoteRequest);

  if (!isRecord(loaded)) {
    throw new Error(
      `[BFF][Effect] Backend federation expose ${remoteRequest} did not return an Effect API module.`,
    );
  }

  const backendContract = loaded.backendFederationContract;
  if (
    !isRecord(backendContract) ||
    backendContract.strictEffectApproach !== true
  ) {
    throw new Error(
      `[BFF][Effect] Backend federation expose ${remoteRequest} must declare strictEffectApproach: true.`,
    );
  }

  if (backendContract.runtimeFramework !== 'effect') {
    throw new Error(
      `[BFF][Effect] Backend federation expose ${remoteRequest} must declare runtimeFramework: "effect".`,
    );
  }

  return loaded as BackendFederatedEffectApiModule;
}
