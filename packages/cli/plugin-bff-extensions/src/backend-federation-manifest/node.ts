import { evaluateNodeBackendFederationCommonJs } from '@modern-js/server-runtime-extensions/backend-federation-security/node';

import type { BackendFederatedEffectApiModule } from '../backend-federation';
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
        evaluateNodeBackendFederationCommonJs,
    },
  });
}
