import { evaluateNodeBackendFederationCommonJs } from '@modern-js/server-runtime-extensions/backend-federation-security/node';
import { loadBackendFederatedEffectApi as loadUniversalBackendFederatedEffectApi } from './load';
import { effectBffHostShared } from './node-shared';

/** Pass as `shared` when building a custom runtime for Node hosts. */
export { effectBffHostShared };

import type {
  BackendFederatedEffectApiModule,
  BackendFederationIdentityLoadOptions,
} from './types';

export function loadBackendFederatedEffectApi(
  options: BackendFederationIdentityLoadOptions,
): Promise<BackendFederatedEffectApiModule> {
  return loadUniversalBackendFederatedEffectApi({
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
