// @effect-diagnostics asyncFunction:off globalFetch:off strictBooleanExpressions:off

import {
  BACKEND_FEDERATION_CONTRACT_VERSION,
  BACKEND_FEDERATION_EFFECT_EXPOSE,
  BACKEND_FEDERATION_MANIFEST_FILE,
  BACKEND_FEDERATION_NODE_ADAPTER_VERSION,
} from '@modern-js/utils/universal';

export {
  type BackendFederationExpectedIdentity,
  type BackendFederationIdentityIssue,
  validateExpectedBackendFederationIdentity,
} from './backend-federation/identity';
export { loadBackendFederatedEffectApi } from './backend-federation/load';

export { createBackendFederationLoadEntryPlugin } from './backend-federation/plugin';
export { createBackendFederationRuntime } from './backend-federation/runtime';
export type {
  BackendFederatedEffectApiModule,
  BackendFederationEntryExports,
  BackendFederationIdentityLoadOptions,
  BackendFederationLoadEntryPluginOptions,
  BackendFederationRemote,
  BackendFederationRuntimeOptions,
} from './backend-federation/types';
export {
  BACKEND_FEDERATION_CONTRACT_VERSION,
  BACKEND_FEDERATION_EFFECT_EXPOSE,
  BACKEND_FEDERATION_MANIFEST_FILE,
  BACKEND_FEDERATION_NODE_ADAPTER_VERSION,
};
