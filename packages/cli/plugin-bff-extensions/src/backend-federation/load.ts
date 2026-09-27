import { BACKEND_FEDERATION_EFFECT_EXPOSE } from '@modern-js/backend-federation-contracts';

import { collectRemotes } from './remotes';
import { createBackendFederationRuntime } from './runtime';
import type {
  BackendFederatedEffectApiModule,
  BackendFederationIdentityLoadOptions,
} from './types';
import { normalizeExpose } from './utils';
import { validateLoadedBackendFederatedEffectApi } from './validate-loaded';

/**
 * Load a federated Effect API with mandatory delivery-unit identity
 * validation (MV-G23): the loaded expose's compatibility metadata must match
 * `expected.unitId` + `expected.buildMarker`.
 */
export function loadBackendFederatedEffectApi(
  options: BackendFederationIdentityLoadOptions,
): Promise<BackendFederatedEffectApiModule> {
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

  if (options.runtime !== undefined) {
    const configuredRemote = collectRemotes(options).find(
      remote => remote.name === remoteName,
    );
    if (
      configuredRemote === undefined ||
      !/^(?:binding|service|static):/u.test(configuredRemote.entry)
    ) {
      return Promise.reject(
        new Error(
          '[BFF][Effect] A custom Module Federation runtime requires a caller-pinned static or service-binding remote and cannot execute network backend federation entries.',
        ),
      );
    }
    if (
      configuredRemote.verification !== undefined ||
      options.entryPolicy?.expected !== undefined
    ) {
      return Promise.reject(
        new Error(
          '[BFF][Effect] A custom Module Federation runtime cannot bypass verified backend entry loading.',
        ),
      );
    }
  }

  const runtime = options.runtime ?? createBackendFederationRuntime(options);
  const expose =
    options.expose ??
    options.remote?.expose ??
    BACKEND_FEDERATION_EFFECT_EXPOSE;
  const remoteRequest = `${remoteName}/${normalizeExpose(expose)}`;
  return runtime.loadRemote(remoteRequest).then(loaded =>
    validateLoadedBackendFederatedEffectApi(loaded, {
      expected: options.expected,
      remoteName,
      remoteRequest,
    }),
  );
}
