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
} from './identity';
export { createBackendFederationLoadEntryPlugin } from './plugin';
export { createBackendFederationRuntime } from './runtime';
export type {
  BackendFederatedEffectApiModule,
  BackendFederationEntryExports,
  BackendFederationIdentityLoadOptions,
  BackendFederationLoadEntryPluginOptions,
  BackendFederationRemote,
  BackendFederationRuntimeOptions,
} from './types';
export {
  BACKEND_FEDERATION_CONTRACT_VERSION,
  BACKEND_FEDERATION_EFFECT_EXPOSE,
  BACKEND_FEDERATION_MANIFEST_FILE,
  BACKEND_FEDERATION_NODE_ADAPTER_VERSION,
};
