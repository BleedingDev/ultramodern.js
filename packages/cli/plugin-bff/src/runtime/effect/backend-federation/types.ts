import type {
  BackendFederationRemoteEntryPolicy,
  BackendFederationRemoteEntryVerification,
} from '@modern-js/server-runtime-extensions/backend-federation-security';
import type { BACKEND_FEDERATION_EFFECT_EXPOSE } from '@modern-js/utils/universal';
import type {
  ModuleFederation,
  ModuleFederationRuntimePlugin,
} from '@module-federation/runtime';

import type { EffectApiModule } from '../module';
import type { BackendFederationExpectedIdentity } from './identity';

export type BackendFederationRemote = {
  name: string;
  entry: string;
  type?: 'commonjs-module' | 'module' | string;
  entryGlobalName?: string;
  shareScope?: string | string[];
  expose?: typeof BACKEND_FEDERATION_EFFECT_EXPOSE;
  verification?: BackendFederationRemoteEntryVerification;
};

export type BackendFederationRuntimeOptions = {
  hostName: string;
  remote?: BackendFederationRemote;
  remotes?: BackendFederationRemote[];
  plugins?: ModuleFederationRuntimePlugin[];
  entryPolicy?: BackendFederationRemoteEntryPolicy;
};

export type BackendFederationEntryExports = {
  get: (
    id: string,
  ) =>
    | (() => Promise<unknown> | unknown)
    | Promise<() => Promise<unknown> | unknown>;
  init?: (...args: unknown[]) => void | Promise<void>;
};

export type BackendFederatedEffectApiModule = EffectApiModule & {
  backendFederationContract?: {
    compatibility?: {
      build?: unknown;
      contractVersion?: unknown;
      nodeAdapterVersion?: unknown;
      packageName?: unknown;
      /**
       * ADR-0019 delivery-unit identity root, generator-emitted alongside
       * manifest's `versionBoundary.deliveryUnit`. Additive/optional.
       */
      unitId?: unknown;
      /** ADR-0019 delivery-unit source revision. Additive/optional. */
      sourceRevision?: unknown;
    };
    name?: unknown;
    role?: unknown;
    runtimeFramework?: unknown;
    strictEffectApproach?: unknown;
  };
  contract?: unknown;
  operationContexts?: unknown;
  runtime?: unknown;
};

export type BackendFederationLoadEntryPluginOptions = {
  resolveEntry: (
    remote: BackendFederationRemote,
  ) =>
    | BackendFederationEntryExports
    | undefined
    | Promise<BackendFederationEntryExports | undefined>;
};

export type BackendFederationLoadOptions = BackendFederationRuntimeOptions & {
  runtime?: ModuleFederation;
  remoteName?: string;
  expose?: string;
};

/**
 * Identity-aware public load options (MV-G23): the expected delivery-unit
 * `unitId` + `buildMarker` are mandatory and validated against the loaded
 * expose's compatibility metadata.
 */
export type BackendFederationIdentityLoadOptions =
  BackendFederationLoadOptions & {
    expected: BackendFederationExpectedIdentity;
    /**
     * Tolerate legacy exposes without identity metadata (mismatching declared
     * values still fail). Prefer leaving this unset: identity-less exposes
     * cannot be validated against a resolved delivery-unit record.
     */
    allowMissingIdentityMetadata?: boolean;
  };

export type BackendFederationLoadEntryPlugin = ModuleFederationRuntimePlugin & {
  loadEntry?: (args: {
    remoteInfo: BackendFederationRemote;
  }) =>
    | BackendFederationEntryExports
    | undefined
    | Promise<BackendFederationEntryExports | undefined>;
};
