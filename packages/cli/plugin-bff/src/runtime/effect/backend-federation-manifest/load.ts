// @effect-diagnostics asyncFunction:off extendsNativeError:off globalTimers:off newPromise:off strictBooleanExpressions:off

import { createInstance } from '@module-federation/runtime';
import {
  BACKEND_FEDERATION_EFFECT_EXPOSE,
  type BackendFederatedEffectApiModule,
  type BackendFederationRemote,
  loadBackendFederatedEffectApi,
} from '../backend-federation';
import { BackendFederationManifestAdapterError } from './errors';
import {
  loadBackendFederationManifest,
  resolveBackendFederationManifestReference,
  withTimeout,
} from './reference';
import { resolveBackendFederationRemoteFromManifest } from './remote';
import type {
  BackendFederationManifest,
  BackendFederationManifestAdapterOptions,
} from './types';
import {
  classifyLoadError,
  validateBackendFederationManifest,
  validateLoadedBackendFederationContract,
} from './validation';

export async function loadBackendFederatedEffectApiFromManifest(
  options: BackendFederationManifestAdapterOptions,
): Promise<BackendFederatedEffectApiModule> {
  let manifest: BackendFederationManifest | undefined;
  let remote: BackendFederationRemote | undefined;

  try {
    manifest = await loadBackendFederationManifest(options);
    validateBackendFederationManifest(manifest, options.expected);
    remote = resolveBackendFederationRemoteFromManifest(
      manifest,
      options.remote,
    );
    const manifestReference =
      resolveBackendFederationManifestReference(options);
    const officialRuntime =
      manifestReference &&
      /^https?:\/\//iu.test(manifestReference) &&
      options.manifest === undefined &&
      options.manifestPath === undefined &&
      options.fetch === undefined &&
      options.plugins === undefined &&
      options.remote === undefined &&
      options.runtime === undefined
        ? createInstance({
            name: options.hostName,
            remotes: [
              {
                name: remote.name,
                entry: manifestReference,
              },
            ],
          })
        : undefined;

    const loaded = await withTimeout(
      loadBackendFederatedEffectApi({
        hostName: options.hostName,
        remote,
        ...(options.plugins ? { plugins: options.plugins } : {}),
        ...(options.runtime
          ? { runtime: options.runtime }
          : officialRuntime
            ? { runtime: officialRuntime }
            : {}),
        // MV-G23: route the manifest adapter through the raw loader's shared
        // delivery-unit identity validation when an identity is expected.
        ...(options.expected?.unitId && options.expected.buildMarker
          ? {
              expected: {
                unitId: options.expected.unitId,
                buildMarker: options.expected.buildMarker,
              },
              // The manifest's identity is already validated against
              // `expected`; legacy exposes without identity metadata stay
              // loadable (mismatching declared values still fail).
              allowMissingIdentityMetadata: true,
            }
          : {}),
      }),
      options.timeoutMs,
      `Backend federation remote ${remote.name}`,
    ).catch((error: unknown) => {
      throw new BackendFederationManifestAdapterError(
        classifyLoadError(error),
        `[BFF][Effect] Backend federation remote ${remote?.name ?? 'unknown'} could not load ${remote?.expose ?? BACKEND_FEDERATION_EFFECT_EXPOSE}.`,
        error,
      );
    });

    validateLoadedBackendFederationContract(loaded, manifest, remote);

    return loaded;
  } catch (error) {
    const adapterError =
      error instanceof BackendFederationManifestAdapterError
        ? error
        : new BackendFederationManifestAdapterError(
            'remote_unavailable',
            '[BFF][Effect] Backend federation manifest adapter failed.',
            error,
          );

    if (options.fallback) {
      return options.fallback(adapterError, { manifest, remote });
    }

    throw adapterError;
  }
}
