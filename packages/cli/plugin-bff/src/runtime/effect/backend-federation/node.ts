import { evaluateNodeBackendFederationCommonJs } from '@modern-js/server-runtime-extensions/backend-federation-security/node';

import type { BackendFederationExpectedIdentity } from './identity';
import { loadBackendFederatedEffectApi as loadUniversalBackendFederatedEffectApi } from './load';
import type {
  BackendFederatedEffectApiModule,
  BackendFederationIdentityLoadOptions,
  BackendFederationLoadOptions,
} from './types';

export function loadBackendFederatedEffectApi(
  options: BackendFederationIdentityLoadOptions,
): Promise<BackendFederatedEffectApiModule>;
/** @deprecated Pass `expected` delivery-unit identity. */
export function loadBackendFederatedEffectApi(
  options: BackendFederationLoadOptions,
): Promise<BackendFederatedEffectApiModule>;
export function loadBackendFederatedEffectApi(
  options: BackendFederationLoadOptions & {
    expected?: BackendFederationExpectedIdentity;
    allowMissingIdentityMetadata?: boolean;
  },
): Promise<BackendFederatedEffectApiModule> {
  return loadUniversalBackendFederatedEffectApi({
    ...options,
    entryPolicy: {
      ...options.entryPolicy,
      evaluateCommonJs:
        options.entryPolicy?.evaluateCommonJs ??
        evaluateNodeBackendFederationCommonJs,
    },
  });
}
