// @effect-diagnostics asyncFunction:off extendsNativeError:off globalTimers:off newPromise:off strictBooleanExpressions:off

import type {
  BackendFederationRemoteEntryPolicy,
  BackendFederationResourcePolicy,
  BackendFederationResourceResponse,
} from '@modern-js/server-runtime-extensions/backend-federation-security';
import type {
  ModuleFederation,
  ModuleFederationRuntimePlugin,
} from '@module-federation/runtime';
import type {
  BackendFederatedEffectApiModule,
  BackendFederationRemote,
} from '../backend-federation';
import type { BackendFederationManifestAdapterError } from './errors';

export type BackendFederationManifest = Record<string, unknown>;

export type BackendFederationVersionBoundaryExpectation = {
  buildVersion?: string;
  /**
   * Delivery-unit build marker (ADR-0019). Semantically the same value as
   * `buildVersion`; treated as an alias. If both are set and disagree the
   * expectation itself is invalid and fails closed before any manifest
   * comparison runs.
   */
  buildMarker?: string;
  contractVersion?: string;
  nodeAdapterVersion?: string;
  packageName?: string;
  remoteName?: string;
  /**
   * Delivery-unit identity root (ADR-0019 §3). When set, the manifest's
   * `backendFederation.versionBoundary.deliveryUnit.unitId` (or the
   * top-level `backendFederation.deliveryUnit.unitId` fallback) must match.
   */
  unitId?: string;
  version?: string;
};

export type BackendFederationManifestFetchResponse =
  BackendFederationResourceResponse;

export type BackendFederationManifestAdapterFallback = (
  error: BackendFederationManifestAdapterError,
  context: {
    manifest?: BackendFederationManifest;
    remote?: BackendFederationRemote;
  },
) => BackendFederatedEffectApiModule | Promise<BackendFederatedEffectApiModule>;

export type BackendFederationManifestAdapterOptions = {
  entryPolicy?: BackendFederationRemoteEntryPolicy;
  env?: Record<string, string | undefined>;
  expected?: BackendFederationVersionBoundaryExpectation;
  fallback?: BackendFederationManifestAdapterFallback;
  fetch?: (
    url: string,
    init?: RequestInit,
  ) => Promise<BackendFederationManifestFetchResponse>;
  hostName: string;
  manifest?: BackendFederationManifest;
  manifestEnv?: string;
  manifestPolicy?: Omit<BackendFederationResourcePolicy, 'fetch'>;
  manifestPath?: string;
  manifestUrl?: string;
  plugins?: ModuleFederationRuntimePlugin[];
  remote?: Partial<BackendFederationRemote>;
  runtime?: ModuleFederation;
  signal?: AbortSignal;
  timeoutMs?: number;
};
