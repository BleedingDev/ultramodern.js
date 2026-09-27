import { evaluateNodeBackendFederationCommonJs } from '@modern-js/server-runtime-extensions/backend-federation-security/node';
import { loadBackendFederatedEffectApi as loadUniversalBackendFederatedEffectApi } from './load';
import { effectBffHostShared, withEffectBffHostShared } from './node-shared';

/** Pass as `shared` when building a custom runtime for Node hosts. */
export { effectBffHostShared };

import type {
  BackendFederatedEffectApiModule,
  BackendFederationIdentityLoadOptions,
} from './types';

export async function loadBackendFederatedEffectApi(
  options: BackendFederationIdentityLoadOptions,
): Promise<BackendFederatedEffectApiModule> {
  return loadUniversalBackendFederatedEffectApi({
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
