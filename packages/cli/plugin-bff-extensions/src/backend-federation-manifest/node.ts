import { evaluateNodeBackendFederationCommonJs } from '@modern-js/server-runtime-extensions/backend-federation-security/node';
import type { BackendFederatedEffectApiModule } from '../backend-federation';
import { effectBffHostShared } from '../backend-federation/node-shared';
import { loadBackendFederatedEffectApiFromManifest as loadUniversalBackendFederatedEffectApiFromManifest } from './load';
import type { BackendFederationManifestAdapterOptions } from './types';

export function loadBackendFederatedEffectApiFromManifest(
  options: BackendFederationManifestAdapterOptions,
): Promise<BackendFederatedEffectApiModule> {
  return loadUniversalBackendFederatedEffectApiFromManifest({
    ...options,
    shared: { ...effectBffHostShared, ...options.shared },
    entryPolicy: {
      ...options.entryPolicy,
      evaluateCommonJs:
        options.entryPolicy?.evaluateCommonJs ??
        evaluateNodeBackendFederationCommonJs,
    },
  });
}
