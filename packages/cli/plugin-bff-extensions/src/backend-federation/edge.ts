import {
  BACKEND_FEDERATION_CONTRACT_VERSION,
  BACKEND_FEDERATION_EFFECT_EXPOSE,
  BACKEND_FEDERATION_MANIFEST_FILE,
  BACKEND_FEDERATION_NODE_ADAPTER_VERSION,
} from '@modern-js/backend-federation-contracts';
import {
  type BackendFederationEdgeLoadEntryPlugin,
  type BackendFederationEdgeLoadEntryPluginOptions,
  type BackendFederationEdgeRemote,
  type BackendFederationEdgeRuntimeOptions,
  createBackendFederationRuntime,
} from './edge-runtime';
import type {
  BackendFederatedEffectApiModule,
  BackendFederationLoadOptions,
  BackendFederationIdentityLoadOptions as UniversalBackendFederationIdentityLoadOptions,
} from './types';
import { normalizeExpose } from './utils';

export {
  type BackendFederationEdgeLoadEntryPlugin,
  type BackendFederationEdgeLoadEntryPluginOptions,
  type BackendFederationEdgeRemote,
  type BackendFederationEdgeRuntime,
  type BackendFederationEdgeRuntimeOptions,
  createBackendFederationLoadEntryPlugin,
  createBackendFederationRuntime,
} from './edge-runtime';
export {
  type BackendFederationExpectedIdentity,
  type BackendFederationIdentityIssue,
  validateExpectedBackendFederationIdentity,
} from './identity';
export type {
  BackendFederatedEffectApiModule,
  BackendFederationEntryExports,
} from './types';

export {
  BACKEND_FEDERATION_CONTRACT_VERSION,
  BACKEND_FEDERATION_EFFECT_EXPOSE,
  BACKEND_FEDERATION_MANIFEST_FILE,
  BACKEND_FEDERATION_NODE_ADAPTER_VERSION,
};

export type BackendFederationRemote = BackendFederationEdgeRemote;
export type BackendFederationRuntimeOptions =
  BackendFederationEdgeRuntimeOptions;
export type BackendFederationLoadEntryPluginOptions =
  BackendFederationEdgeLoadEntryPluginOptions;

export type EdgeBackendFederationLoadOptions = Omit<
  BackendFederationLoadOptions,
  'entryPolicy' | 'plugins' | 'remote' | 'remotes' | 'runtime' | 'shared'
> & {
  entryPolicy?: never;
  plugins?: BackendFederationEdgeLoadEntryPlugin[];
  remote?: BackendFederationEdgeRemote;
  remotes?: BackendFederationEdgeRemote[];
  runtime?: never;
  shared?: never;
};

export type EdgeBackendFederationIdentityLoadOptions = Omit<
  UniversalBackendFederationIdentityLoadOptions,
  'entryPolicy' | 'plugins' | 'remote' | 'remotes' | 'runtime' | 'shared'
> & {
  entryPolicy?: never;
  plugins?: BackendFederationEdgeLoadEntryPlugin[];
  remote?: BackendFederationEdgeRemote;
  remotes?: BackendFederationEdgeRemote[];
  runtime?: never;
  shared?: never;
};

export type BackendFederationIdentityLoadOptions =
  EdgeBackendFederationIdentityLoadOptions;

export function loadBackendFederatedEffectApi(
  options: EdgeBackendFederationIdentityLoadOptions,
): Promise<BackendFederatedEffectApiModule> {
  if (
    (options as BackendFederationLoadOptions).runtime !== undefined ||
    (options as BackendFederationLoadOptions).entryPolicy !== undefined ||
    (options as BackendFederationLoadOptions).shared !== undefined
  ) {
    return Promise.reject(
      new Error(
        '[BFF][Effect] Edge backend federation does not execute custom runtimes, entry evaluators or host shares. Register a static or service-binding entry provider.',
      ),
    );
  }

  const remoteName = options.remote?.name ?? options.remoteName;
  if (remoteName === undefined || remoteName.length === 0) {
    return Promise.reject(
      new Error('[BFF][Effect] Missing backend federation remote name.'),
    );
  }

  if (!options.expected?.unitId || !options.expected.buildMarker) {
    return Promise.reject(
      new Error(
        '[BFF][Effect] Backend federation requires expected.unitId and expected.buildMarker.',
      ),
    );
  }

  const expose =
    options.expose ??
    options.remote?.expose ??
    BACKEND_FEDERATION_EFFECT_EXPOSE;
  const remoteRequest = `${remoteName}/${normalizeExpose(expose)}`;

  let runtime;
  try {
    runtime = createBackendFederationRuntime(options);
  } catch (error) {
    return Promise.reject(error);
  }
  return runtime.loadRemote(remoteRequest);
}
