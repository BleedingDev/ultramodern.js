import type { BackendFederatedEffectApiModule } from '../backend-federation';
import { evaluateEffectBackendFederationCommonJs } from '../backend-federation/node-evaluator';
import { loadBackendFederatedEffectApiFromManifest as loadUniversalBackendFederatedEffectApiFromManifest } from './load';
import type { BackendFederationManifestAdapterOptions } from './types';

export function loadBackendFederatedEffectApiFromManifest(
  options: BackendFederationManifestAdapterOptions,
): Promise<BackendFederatedEffectApiModule> {
  return loadUniversalBackendFederatedEffectApiFromManifest({
    ...options,
    entryPolicy: {
      ...options.entryPolicy,
      evaluateCommonJs:
        options.entryPolicy?.evaluateCommonJs ??
        evaluateEffectBackendFederationCommonJs,
    },
  });
}
