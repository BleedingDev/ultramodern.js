// @effect-diagnostics asyncFunction:off extendsNativeError:off globalTimers:off newPromise:off strictBooleanExpressions:off

import {
  BackendFederationRemoteEntryError,
  loadBoundedBackendFederationResource,
  redactBackendFederationUrl,
} from '@modern-js/server-runtime-extensions/backend-federation-security';
import { BACKEND_FEDERATION_MANIFEST_FILE } from '../backend-federation';
import {
  assertManifestAdapter,
  BackendFederationManifestAdapterError,
} from './errors';
import { isRecord } from './metadata';
import type {
  BackendFederationManifest,
  BackendFederationManifestAdapterOptions,
} from './types';

function getProcessEnv() {
  return typeof process !== 'undefined' ? process.env : undefined;
}

type ManifestReferenceSource = 'env' | 'path' | 'url';

function resolveManifestReferenceSource(
  options: Pick<
    BackendFederationManifestAdapterOptions,
    'manifestEnv' | 'manifestPath' | 'manifestUrl'
  >,
): ManifestReferenceSource | undefined {
  if (options.manifestPath) {
    return 'path';
  }
  if (options.manifestUrl) {
    return 'url';
  }
  if (options.manifestEnv) {
    return 'env';
  }
  return undefined;
}

export function resolveBackendFederationManifestReference(
  options: Pick<
    BackendFederationManifestAdapterOptions,
    'env' | 'manifestEnv' | 'manifestPath' | 'manifestUrl'
  >,
) {
  if (options.manifestPath) {
    return options.manifestPath;
  }

  if (options.manifestUrl) {
    return options.manifestUrl;
  }

  if (!options.manifestEnv) {
    return undefined;
  }

  return (
    options.env?.[options.manifestEnv] ?? getProcessEnv()?.[options.manifestEnv]
  );
}

function assertExpectedIdentityForReference(
  options: Pick<BackendFederationManifestAdapterOptions, 'expected'>,
  source: ManifestReferenceSource | undefined,
) {
  if (source === undefined || source === 'path') {
    return;
  }

  if (options.expected?.unitId && options.expected.buildMarker) {
    return;
  }

  throw new BackendFederationManifestAdapterError(
    'version_mismatch',
    `[BFF][Effect] Backend federation ${source} manifest references require expected.unitId and expected.buildMarker.`,
    undefined,
    {
      label: 'expected.deliveryUnit',
      expected: 'unitId + buildMarker',
      received: options.expected,
      referenceSource: source,
    },
  );
}

function isHttpUrl(value: string) {
  return /^https?:\/\//iu.test(value);
}

function referenceForDiagnostics(reference: string) {
  return isHttpUrl(reference)
    ? redactBackendFederationUrl(reference)
    : '[local manifest]';
}

async function readFileReference(reference: string) {
  const [{ fileURLToPath }, fs] = await Promise.all([
    import('node:url'),
    import('node:fs/promises'),
  ]);
  const filePath = reference.startsWith('file:')
    ? fileURLToPath(reference)
    : reference;

  return fs.readFile(filePath, 'utf8');
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  label: string,
) {
  if (!timeoutMs || timeoutMs <= 0) {
    return promise;
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
          reject(
            new BackendFederationManifestAdapterError(
              'timeout',
              `[BFF][Effect] ${label} timed out after ${timeoutMs}ms.`,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function loadBackendFederationManifest(
  options: Pick<
    BackendFederationManifestAdapterOptions,
    | 'env'
    | 'expected'
    | 'fetch'
    | 'manifest'
    | 'manifestEnv'
    | 'manifestPolicy'
    | 'manifestPath'
    | 'manifestUrl'
    | 'signal'
    | 'timeoutMs'
  >,
): Promise<BackendFederationManifest> {
  if (options.manifest) {
    return options.manifest;
  }

  const reference = resolveBackendFederationManifestReference(options);
  if (!reference) {
    throw new BackendFederationManifestAdapterError(
      'manifest_unavailable',
      `[BFF][Effect] Backend federation manifest reference is missing. Pass manifest, manifestPath, manifestUrl, or manifestEnv for ${BACKEND_FEDERATION_MANIFEST_FILE}.`,
    );
  }
  assertExpectedIdentityForReference(
    options,
    resolveManifestReferenceSource(options),
  );
  const referenceSource = resolveManifestReferenceSource(options);
  if (referenceSource === 'path' && isHttpUrl(reference)) {
    throw new BackendFederationManifestAdapterError(
      'manifest_unavailable',
      '[BFF][Effect] Backend federation manifestPath must identify an explicit local file. Use manifestUrl for HTTP(S) manifests.',
    );
  }
  if (
    (referenceSource === 'url' || referenceSource === 'env') &&
    !isHttpUrl(reference)
  ) {
    throw new BackendFederationManifestAdapterError(
      'manifest_unavailable',
      `[BFF][Effect] Backend federation ${referenceSource} manifest references must use HTTP(S). Use manifestPath for an explicit local file.`,
    );
  }

  try {
    const diagnosticReference = referenceForDiagnostics(reference);
    const source = isHttpUrl(reference)
      ? new TextDecoder('utf-8', { fatal: true }).decode(
          await loadBoundedBackendFederationResource(reference, {
            allowInsecureHttp:
              options.manifestPolicy?.allowInsecureHttp === true,
            fetch: options.fetch,
            kind: 'manifest',
            maxBytes: options.manifestPolicy?.maxBytes,
            signal: options.manifestPolicy?.signal ?? options.signal,
            timeoutMs: options.manifestPolicy?.timeoutMs ?? options.timeoutMs,
          }),
        )
      : await withTimeout(
          readFileReference(reference),
          options.manifestPolicy?.timeoutMs ?? options.timeoutMs,
          'Backend federation local manifest',
        );
    const manifest = JSON.parse(source) as unknown;

    assertManifestAdapter(
      isRecord(manifest),
      'manifest_invalid',
      `[BFF][Effect] Backend federation manifest ${diagnosticReference} must be a JSON object.`,
    );

    return manifest;
  } catch (error) {
    if (error instanceof BackendFederationManifestAdapterError) {
      throw error;
    }

    if (error instanceof BackendFederationRemoteEntryError) {
      throw new BackendFederationManifestAdapterError(
        error.code === 'timeout' ? 'timeout' : 'manifest_unavailable',
        `[BFF][Effect] ${error.message}`,
        error,
        error.details,
      );
    }

    throw new BackendFederationManifestAdapterError(
      'manifest_unavailable',
      `[BFF][Effect] Backend federation manifest ${referenceForDiagnostics(reference)} could not be loaded.`,
      error,
    );
  }
}
