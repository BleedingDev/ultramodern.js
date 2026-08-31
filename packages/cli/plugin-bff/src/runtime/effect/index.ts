export * as OpenTelemetry from '@effect/opentelemetry';
export {
  BACKEND_FEDERATION_CONTRACT_VERSION,
  BACKEND_FEDERATION_EFFECT_EXPOSE,
  BACKEND_FEDERATION_MANIFEST_FILE,
  BACKEND_FEDERATION_NODE_ADAPTER_VERSION,
  type BackendFederatedEffectApiModule,
  type BackendFederationEntryExports,
  type BackendFederationExpectedIdentity,
  type BackendFederationIdentityIssue,
  type BackendFederationIdentityLoadOptions,
  type BackendFederationLoadEntryPluginOptions,
  type BackendFederationRemote,
  type BackendFederationRuntimeOptions,
  createBackendFederationLoadEntryPlugin,
  createBackendFederationRuntime,
  validateExpectedBackendFederationIdentity,
} from './backend-federation';
export { loadBackendFederatedEffectApi } from './backend-federation/node';
export {
  type BackendFederationManifest,
  BackendFederationManifestAdapterError,
  type BackendFederationManifestAdapterErrorCode,
  type BackendFederationManifestAdapterFallback,
  type BackendFederationManifestAdapterOptions,
  type BackendFederationManifestFetchResponse,
  type BackendFederationVersionBoundaryExpectation,
  // Generated UltraModern workspace proof scripts import the manifest adapter
  // through this public barrel; keep these exports stable.
  loadBackendFederationManifest,
  resolveBackendFederationRemoteFromManifest,
} from './backend-federation-manifest';
export { loadBackendFederatedEffectApiFromManifest } from './backend-federation-manifest/node';
export {
  type CreateEffectOperationContextOptions,
  createEffectOperationContext,
  type EffectContext,
  runWithEffectContext,
  useEffectContext,
  useOperationContext,
} from './context';
export {
  createEffectBffEdgeHandler,
  createEffectBffTestHandler,
  dispatchEffectBffRequest,
} from './edge';
export * from './handler';
