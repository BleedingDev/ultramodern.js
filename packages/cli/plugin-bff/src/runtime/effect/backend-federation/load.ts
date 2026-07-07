// @effect-diagnostics asyncFunction:off strictBooleanExpressions:off

import { BACKEND_FEDERATION_EFFECT_EXPOSE } from '@modern-js/utils/universal';

import { createBackendFederationRuntime } from './runtime';
import type {
  BackendFederatedEffectApiModule,
  BackendFederationLoadOptions,
} from './types';
import { isRecord, normalizeExpose } from './utils';

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
