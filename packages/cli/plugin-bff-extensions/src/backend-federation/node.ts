import { loadBackendFederatedEffectApi as loadUniversalBackendFederatedEffectApi } from './load';
import { evaluateEffectBackendFederationCommonJs } from './node-evaluator';
import type {
  BackendFederatedEffectApiModule,
  BackendFederationIdentityLoadOptions,
  BackendFederationLoadOptions,
} from './types';

export function loadBackendFederatedEffectApi(
  options: BackendFederationIdentityLoadOptions,
): Promise<BackendFederatedEffectApiModule> {
  return loadUniversalBackendFederatedEffectApi({
    ...options,
    entryPolicy: {
      ...options.entryPolicy,
      evaluateCommonJs:
        options.entryPolicy?.evaluateCommonJs ??
        evaluateEffectBackendFederationCommonJs,
    },
  });
}
