// @effect-diagnostics asyncFunction:off extendsNativeError:off globalTimers:off newPromise:off strictBooleanExpressions:off

import {
  BACKEND_FEDERATION_EFFECT_EXPOSE,
  type BackendFederatedEffectApiModule,
  type BackendFederationRemote,
  loadBackendFederatedEffectApi,
} from '../backend-federation';
import { BackendFederationManifestAdapterError } from './errors';
import { loadBackendFederationManifest } from './reference';
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

function createManifestLoadScope(
  options: BackendFederationManifestAdapterOptions,
) {
  const controller = new AbortController();
  const policyTimeouts = [
    options.manifestPolicy?.timeoutMs,
    options.entryPolicy?.timeoutMs,
  ].filter((timeout): timeout is number => timeout !== undefined);
  const configuredTimeouts = [options.timeoutMs, ...policyTimeouts].filter(
    (timeout): timeout is number => timeout !== undefined,
  );
  for (const timeout of configuredTimeouts) {
    if (!Number.isSafeInteger(timeout) || timeout < 0) {
      throw new BackendFederationManifestAdapterError(
        'manifest_invalid',
        '[BFF][Effect] Backend federation timeoutMs must be a non-negative safe integer.',
      );
    }
  }
  const timeoutMs =
    options.timeoutMs ??
    (policyTimeouts.length > 0 ? Math.min(...policyTimeouts) : 0);
  const inputSignals = [
    options.signal,
    options.manifestPolicy?.signal,
    options.entryPolicy?.signal,
  ].filter((signal): signal is AbortSignal => signal !== undefined);
  const abortListeners: Array<[AbortSignal, () => void]> = [];
  let timedOut = false;
  const forwardAbort = (signal: AbortSignal) => {
    controller.abort(signal.reason);
  };
  for (const signal of inputSignals) {
    if (signal.aborted) {
      forwardAbort(signal);
      break;
    }
    const listener = () => forwardAbort(signal);
    abortListeners.push([signal, listener]);
    signal.addEventListener('abort', listener, { once: true });
  }

  const timeout =
    timeoutMs > 0
      ? setTimeout(() => {
          if (controller.signal.aborted) {
            return;
          }
          timedOut = true;
          controller.abort(
            new BackendFederationManifestAdapterError(
              'timeout',
              `[BFF][Effect] Backend federation load timed out after ${timeoutMs}ms.`,
            ),
          );
        }, timeoutMs)
      : undefined;

  return {
    cleanup() {
      if (timeout) {
        clearTimeout(timeout);
      }
      for (const [signal, listener] of abortListeners) {
        signal.removeEventListener('abort', listener);
      }
    },
    signal: controller.signal,
    timedOut: () => timedOut,
    timeoutMs,
  };
}

function isRemoteManifestReference(
  options: BackendFederationManifestAdapterOptions,
) {
  if (options.manifest !== undefined || options.manifestPath) {
    return false;
  }
  return Boolean(options.manifestUrl || options.manifestEnv);
}

function hasPinnedRemoteEntryExpectation(
  options: BackendFederationManifestAdapterOptions,
) {
  const expected = options.entryPolicy?.expected;
  return (
    typeof expected?.byteLength === 'number' &&
    typeof expected.entryUrl === 'string' &&
    typeof expected.remoteName === 'string' &&
    typeof expected.sha256 === 'string'
  );
}

function isCallerPinnedStaticRemote(
  options: BackendFederationManifestAdapterOptions,
  remote: BackendFederationRemote,
) {
  return (
    options.remote?.entry === remote.entry &&
    options.remote?.name === remote.name &&
    /^(?:binding|service|static):/u.test(remote.entry)
  );
}

function throwIfManifestLoadAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw new BackendFederationManifestAdapterError(
      'remote_unavailable',
      '[BFF][Effect] Backend federation load was aborted before remote execution.',
      signal.reason,
    );
  }
}

export async function loadBackendFederatedEffectApiFromManifest(
  options: BackendFederationManifestAdapterOptions,
): Promise<BackendFederatedEffectApiModule> {
  let manifest: BackendFederationManifest | undefined;
  let remote: BackendFederationRemote | undefined;
  let scope: ReturnType<typeof createManifestLoadScope> | undefined;

  try {
    scope = createManifestLoadScope(options);
    throwIfManifestLoadAborted(scope.signal);
    manifest = await loadBackendFederationManifest({
      ...options,
      manifestPolicy: {
        ...options.manifestPolicy,
        signal: scope.signal,
        timeoutMs: 0,
      },
      signal: scope.signal,
      timeoutMs: 0,
    });
    validateBackendFederationManifest(manifest, options.expected);
    remote = resolveBackendFederationRemoteFromManifest(
      manifest,
      options.remote,
    );
    throwIfManifestLoadAborted(scope.signal);
    const remoteManifest = isRemoteManifestReference(options);
    if (remoteManifest && options.runtime !== undefined) {
      throw new BackendFederationManifestAdapterError(
        'manifest_invalid',
        `[BFF][Effect] Backend federation remote ${remote.name} cannot use a custom runtime selected by a network manifest.`,
      );
    }
    if (
      remoteManifest &&
      !/^https?:\/\//iu.test(remote.entry) &&
      !isCallerPinnedStaticRemote(options, remote)
    ) {
      throw new BackendFederationManifestAdapterError(
        'manifest_invalid',
        `[BFF][Effect] Backend federation network manifests cannot select local, global, or plugin entry ${remote.entry}. Pin a static/service binding in caller configuration or use a verified HTTP(S) entry.`,
      );
    }
    if (
      remoteManifest &&
      /^https?:\/\//iu.test(remote.entry) &&
      !hasPinnedRemoteEntryExpectation(options)
    ) {
      throw new BackendFederationManifestAdapterError(
        'manifest_invalid',
        `[BFF][Effect] Backend federation remote ${remote.name} from a network manifest requires caller-pinned entryUrl, remoteName, sha256, and byteLength values.`,
      );
    }
    if (
      /^https?:\/\//iu.test(remote.entry) &&
      remote.verification === undefined &&
      options.entryPolicy?.expected === undefined
    ) {
      throw new BackendFederationManifestAdapterError(
        'manifest_invalid',
        `[BFF][Effect] Backend federation remote ${remote.name} requires entry.sha256 and entry.byteLength before network execution.`,
      );
    }
    if (/^https?:\/\//iu.test(remote.entry) && options.runtime !== undefined) {
      throw new BackendFederationManifestAdapterError(
        'manifest_invalid',
        `[BFF][Effect] Backend federation remote ${remote.name} cannot use a custom runtime for network entry execution.`,
      );
    }

    const loaded = await loadBackendFederatedEffectApi({
      hostName: options.hostName,
      remote,
      ...(options.plugins ? { plugins: options.plugins } : {}),
      entryPolicy: {
        ...options.entryPolicy,
        signal: scope.signal,
        timeoutMs: 0,
      },
      ...(options.runtime ? { runtime: options.runtime } : {}),
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
    }).catch((error: unknown) => {
      throw new BackendFederationManifestAdapterError(
        scope?.timedOut() === true ? 'timeout' : classifyLoadError(error),
        `[BFF][Effect] Backend federation remote ${remote?.name ?? 'unknown'} could not load ${remote?.expose ?? BACKEND_FEDERATION_EFFECT_EXPOSE}.`,
        error,
      );
    });

    validateLoadedBackendFederationContract(loaded, manifest, remote);

    return loaded;
  } catch (error) {
    const adapterError =
      scope?.timedOut() === true
        ? new BackendFederationManifestAdapterError(
            'timeout',
            `[BFF][Effect] Backend federation load timed out after ${scope.timeoutMs}ms.`,
            error,
          )
        : error instanceof BackendFederationManifestAdapterError
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
  } finally {
    scope?.cleanup();
  }
}
