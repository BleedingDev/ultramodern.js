// @effect-diagnostics asyncFunction:off extendsNativeError:off globalTimers:off newPromise:off strictBooleanExpressions:off

import {
  BackendFederationRemoteEntryError,
  resolveBackendFederationRemoteEntryVerification,
} from '@modern-js/server-runtime-extensions/backend-federation-security';
import { backendFederationExposeNames } from '@modern-js/utils/universal';
import {
  BACKEND_FEDERATION_EFFECT_EXPOSE,
  type BackendFederationRemote,
} from '../backend-federation';
import {
  assertManifestAdapter,
  BackendFederationManifestAdapterError,
} from './errors';
import {
  backendFederationMetadata,
  recordField,
  resolveRemoteEntryFromMetadata,
  stringValue,
} from './metadata';
import type { BackendFederationManifest } from './types';

export function resolveBackendFederationRemoteFromManifest(
  manifest: BackendFederationManifest,
  remoteOverride: Partial<BackendFederationRemote> = {},
): BackendFederationRemote {
  const backendFederation = backendFederationMetadata(manifest);
  const entry = recordField(manifest, 'entry');
  const metaData = recordField(manifest, 'metaData');
  const remoteEntry = recordField(metaData, 'remoteEntry');
  const remoteName =
    remoteOverride.name ??
    stringValue(backendFederation?.name) ??
    stringValue(manifest.name) ??
    stringValue(manifest.id);
  const manifestEntryUrl =
    stringValue(backendFederation?.containerEntry) ??
    stringValue(entry?.url) ??
    resolveRemoteEntryFromMetadata(manifest);
  const remoteEntryUrl = remoteOverride.entry ?? manifestEntryUrl;
  const remoteType =
    remoteOverride.type ??
    stringValue(backendFederation?.remoteType) ??
    stringValue(entry?.type) ??
    stringValue(remoteEntry?.type) ??
    'module';
  const expose =
    remoteOverride.expose ??
    backendFederationExposeNames(backendFederation)[0] ??
    BACKEND_FEDERATION_EFFECT_EXPOSE;
  let verification: BackendFederationRemote['verification'];
  try {
    const manifestVerification =
      resolveBackendFederationRemoteEntryVerification(manifest);
    verification =
      remoteOverride.verification ??
      (remoteEntryUrl === manifestEntryUrl ? manifestVerification : undefined);
  } catch (cause) {
    if (cause instanceof BackendFederationRemoteEntryError) {
      throw new BackendFederationManifestAdapterError(
        cause.code === 'identity_mismatch'
          ? 'version_mismatch'
          : 'manifest_invalid',
        `[BFF][Effect] ${cause.message}`,
        cause,
        cause.details,
      );
    }
    throw cause;
  }

  assertManifestAdapter(
    remoteName,
    'manifest_invalid',
    '[BFF][Effect] Backend federation manifest must declare a remote name.',
  );
  assertManifestAdapter(
    remoteEntryUrl,
    'manifest_invalid',
    '[BFF][Effect] Backend federation manifest must declare a backend remote entry URL.',
  );
  assertManifestAdapter(
    expose === BACKEND_FEDERATION_EFFECT_EXPOSE,
    'manifest_invalid',
    `[BFF][Effect] Backend federation manifest expose must be ${BACKEND_FEDERATION_EFFECT_EXPOSE}.`,
  );

  return {
    name: remoteName,
    entry: remoteEntryUrl,
    type: remoteType,
    ...(verification ? { verification } : {}),
    ...(remoteOverride.entryGlobalName
      ? { entryGlobalName: remoteOverride.entryGlobalName }
      : {}),
    expose,
    ...(remoteOverride.shareScope
      ? { shareScope: remoteOverride.shareScope }
      : {}),
  };
}
