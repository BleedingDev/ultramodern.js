import { evaluateNodeBackendFederationCommonJs } from '@modern-js/server-runtime-extensions/backend-federation-security/node';
import type { BackendFederatedEffectApiModule } from '../backend-federation';
import { withEffectBffHostShared } from '../backend-federation/node-shared';
import { loadBackendFederatedEffectApiFromManifest as loadUniversalBackendFederatedEffectApiFromManifest } from './load';
import type { BackendFederationManifestAdapterOptions } from './types';

export async function loadBackendFederatedEffectApiFromManifest(
  options: BackendFederationManifestAdapterOptions,
): Promise<BackendFederatedEffectApiModule> {
  return loadUniversalBackendFederatedEffectApiFromManifest({
    ...options,
    shared: withEffectBffHostShared(options.shared),
    entryPolicy: {
      ...options.entryPolicy,
      evaluateCommonJs:
        options.entryPolicy?.evaluateCommonJs ??
        evaluateNodeBackendFederationCommonJs,
    },
  });
}
