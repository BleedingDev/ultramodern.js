import type {
  ModuleFederation,
  ModuleFederationRuntimePlugin,
} from '@module-federation/runtime';

import {
  BACKEND_FEDERATION_CONTRACT_VERSION,
  BACKEND_FEDERATION_EFFECT_EXPOSE,
  BACKEND_FEDERATION_MANIFEST_FILE,
  BACKEND_FEDERATION_NODE_ADAPTER_VERSION,
  type BackendFederatedEffectApiModule,
  type BackendFederationRemote,
  loadBackendFederatedEffectApi,
} from './backend-federation';

export type BackendFederationManifestAdapterErrorCode =
  | 'manifest_unavailable'
  | 'manifest_invalid'
  | 'remote_unavailable'
  | 'strict_effect_required'
  | 'timeout'
  | 'version_mismatch';

export const BACKEND_FEDERATION_MANIFEST_ADAPTER_FAILURE_EVENT =
  'modernjs:microvertical-server-fallback' as const;

export class BackendFederationManifestAdapterError extends Error {
  code: BackendFederationManifestAdapterErrorCode;
  readonly failureEvent = BACKEND_FEDERATION_MANIFEST_ADAPTER_FAILURE_EVENT;
  details?: Record<string, unknown>;

  constructor(
    code: BackendFederationManifestAdapterErrorCode,
    message: string,
    cause?: unknown,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'BackendFederationManifestAdapterError';
    this.code = code;

    if (details) {
      this.details = details;
    }

    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

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

export type BackendFederationManifestFetchResponse = {
  ok: boolean;
  status: number;
  statusText?: string;
  text: () => Promise<string>;
};

export type BackendFederationManifestAdapterFallback = (
  error: BackendFederationManifestAdapterError,
  context: {
    manifest?: BackendFederationManifest;
    remote?: BackendFederationRemote;
  },
) => BackendFederatedEffectApiModule | Promise<BackendFederatedEffectApiModule>;

export type BackendFederationManifestAdapterOptions = {
  env?: Record<string, string | undefined>;
  expected?: BackendFederationVersionBoundaryExpectation;
  fallback?: BackendFederationManifestAdapterFallback;
  fetch?: (url: string) => Promise<BackendFederationManifestFetchResponse>;
  hostName: string;
  manifest?: BackendFederationManifest;
  manifestEnv?: string;
  manifestPath?: string;
  manifestUrl?: string;
  plugins?: ModuleFederationRuntimePlugin[];
  remote?: Partial<BackendFederationRemote>;
  runtime?: ModuleFederation;
  timeoutMs?: number;
};

function stringValue(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function recordField(
  value: Record<string, unknown> | undefined,
  field: string,
) {
  const fieldValue = value?.[field];
  return isRecord(fieldValue) ? fieldValue : undefined;
}

function assertManifestAdapter(
  condition: unknown,
  code: BackendFederationManifestAdapterErrorCode,
  message: string,
): asserts condition {
  if (!condition) {
    throw new BackendFederationManifestAdapterError(code, message);
  }
}

function assertVersionValue(
  actual: string | undefined,
  expected: string | undefined,
  label: string,
  details?: Record<string, unknown>,
) {
  if (expected === undefined) {
    return;
  }

  if (actual !== expected) {
    throw new BackendFederationManifestAdapterError(
      'version_mismatch',
      `[BFF][Effect] Backend federation ${label} mismatch: expected ${expected}, received ${actual ?? 'undefined'}.`,
      undefined,
      { label, expected, received: actual, ...details },
    );
  }
}

function assertConsistentValue(
  left: string | undefined,
  right: string | undefined,
  label: string,
  details?: Record<string, unknown>,
) {
  if (left === undefined || right === undefined || left === right) {
    return;
  }

  throw new BackendFederationManifestAdapterError(
    'version_mismatch',
    `[BFF][Effect] Backend federation ${label} mismatch: expected ${left}, received ${right}.`,
    undefined,
    { label, expected: left, received: right, ...details },
  );
}

function getProcessEnv() {
  return typeof process !== 'undefined' ? process.env : undefined;
}

function resolveManifestReference(
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

function isHttpUrl(value: string) {
  return /^https?:\/\//iu.test(value);
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

async function withTimeout<T>(
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

function resolveRemoteEntryFromMetadata(manifest: BackendFederationManifest) {
  const metaData = recordField(manifest, 'metaData');
  const remoteEntry = recordField(metaData, 'remoteEntry');
  const publicPath =
    stringValue(metaData?.publicPath) ?? stringValue(metaData?.ssrPublicPath);
  const entryName = stringValue(remoteEntry?.name);

  if (!publicPath || !entryName) {
    return undefined;
  }

  const entryPath = stringValue(remoteEntry?.path) ?? '';
  const normalizedBase = publicPath.replace(/\/+$/u, '');
  const normalizedPath = entryPath.replace(/^\/+|\/+$/gu, '');

  return [normalizedBase, normalizedPath, entryName].filter(Boolean).join('/');
}

function backendFederationMetadata(manifest: BackendFederationManifest) {
  return recordField(manifest, 'backendFederation');
}

function versionBoundaryMetadata(manifest: BackendFederationManifest) {
  return recordField(backendFederationMetadata(manifest), 'versionBoundary');
}

function deliveryUnitMetadata(record: Record<string, unknown> | undefined) {
  return recordField(record, 'deliveryUnit');
}

/**
 * Resolves the delivery-unit identity root for a manifest (ADR-0019 §3):
 * prefers `versionBoundary.deliveryUnit`, falls back to the top-level
 * `backendFederation.deliveryUnit` record. Both are additive/optional so
 * legacy manifests without delivery-unit metadata continue to validate.
 */
function manifestDeliveryUnit(
  backendFederation: Record<string, unknown> | undefined,
  boundary: Record<string, unknown> | undefined,
) {
  return {
    boundary: deliveryUnitMetadata(boundary),
    top: deliveryUnitMetadata(backendFederation),
  };
}

function resolveExpectedBuildMarker(
  expected: BackendFederationVersionBoundaryExpectation,
) {
  if (
    expected.buildVersion !== undefined &&
    expected.buildMarker !== undefined &&
    expected.buildVersion !== expected.buildMarker
  ) {
    throw new BackendFederationManifestAdapterError(
      'version_mismatch',
      `[BFF][Effect] Backend federation expected buildVersion/buildMarker mismatch: buildVersion ${expected.buildVersion}, buildMarker ${expected.buildMarker}.`,
      undefined,
      {
        label: 'expected.buildVersion/buildMarker',
        expected: expected.buildVersion,
        received: expected.buildMarker,
      },
    );
  }

  // Intentionally no fallback to `buildVersion` here: this is only used to
  // compare against manifest `deliveryUnit.buildMarker`, which is a
  // separate, additive field. Callers that only pass `buildVersion` (the
  // pre-ADR-0019 expectation shape) must not be forced to also match a
  // delivery-unit build marker on the manifest.
  return expected.buildMarker;
}

function validateBackendFederationManifest(
  manifest: BackendFederationManifest,
  expected: BackendFederationVersionBoundaryExpectation = {},
) {
  const expectedBuildMarker = resolveExpectedBuildMarker(expected);
  const backendFederation = backendFederationMetadata(manifest);
  assertManifestAdapter(
    backendFederation,
    'manifest_invalid',
    '[BFF][Effect] Backend federation manifest must declare backendFederation metadata.',
  );

  assertManifestAdapter(
    backendFederation.runtimeFramework === 'effect',
    'strict_effect_required',
    '[BFF][Effect] Backend federation manifest must declare runtimeFramework: "effect".',
  );
  assertManifestAdapter(
    backendFederation.strictEffectApproach === true,
    'strict_effect_required',
    '[BFF][Effect] Backend federation manifest must declare strictEffectApproach: true.',
  );

  assertVersionValue(
    stringValue(backendFederation.contractVersion),
    expected.contractVersion ?? BACKEND_FEDERATION_CONTRACT_VERSION,
    'manifest contractVersion',
  );
  assertVersionValue(
    stringValue(backendFederation.nodeAdapterVersion),
    expected.nodeAdapterVersion ?? BACKEND_FEDERATION_NODE_ADAPTER_VERSION,
    'manifest nodeAdapterVersion',
  );

  const boundary = versionBoundaryMetadata(manifest);
  assertVersionValue(
    stringValue(backendFederation.name) ??
      stringValue(manifest.name) ??
      stringValue(manifest.id),
    expected.remoteName,
    'manifest remoteName',
  );
  assertVersionValue(
    stringValue(boundary?.packageName),
    expected.packageName,
    'versionBoundary.packageName',
  );
  assertVersionValue(
    stringValue(boundary?.version),
    expected.version,
    'versionBoundary.version',
  );
  assertVersionValue(
    stringValue(boundary?.buildVersion),
    expected.buildVersion,
    'versionBoundary.buildVersion',
  );
  assertConsistentValue(
    stringValue(manifest.version),
    stringValue(boundary?.version),
    'manifest versionBoundary.version',
  );
  assertConsistentValue(
    stringValue(manifest.buildVersion),
    stringValue(boundary?.buildVersion),
    'manifest versionBoundary.buildVersion',
  );

  const deliveryUnit = manifestDeliveryUnit(backendFederation, boundary);
  assertConsistentValue(
    stringValue(deliveryUnit.boundary?.buildMarker),
    stringValue(boundary?.buildVersion),
    'versionBoundary.deliveryUnit.buildMarker vs versionBoundary.buildVersion',
  );
  assertConsistentValue(
    stringValue(deliveryUnit.top?.unitId),
    stringValue(deliveryUnit.boundary?.unitId),
    'backendFederation.deliveryUnit.unitId vs versionBoundary.deliveryUnit.unitId',
  );

  const manifestUnitId =
    stringValue(deliveryUnit.boundary?.unitId) ??
    stringValue(deliveryUnit.top?.unitId);
  assertVersionValue(manifestUnitId, expected.unitId, 'deliveryUnit.unitId');
  assertVersionValue(
    stringValue(deliveryUnit.boundary?.buildMarker),
    expectedBuildMarker,
    'deliveryUnit.buildMarker',
  );
}

function validateLoadedBackendFederationContract(
  loaded: BackendFederatedEffectApiModule,
  manifest: BackendFederationManifest,
  remote: BackendFederationRemote,
) {
  const loadedContract = loaded.backendFederationContract;
  const backendFederation = backendFederationMetadata(manifest);
  const boundary = versionBoundaryMetadata(manifest);
  const compatibility = recordField(loadedContract, 'compatibility');

  assertManifestAdapter(
    compatibility,
    'version_mismatch',
    `[BFF][Effect] Backend federation expose ${remote.name}/${remote.expose?.replace(
      /^\.\//u,
      '',
    )} must declare compatibility metadata.`,
  );
  assertVersionValue(
    stringValue(loadedContract?.role),
    'microvertical-server',
    'expose role',
  );
  assertVersionValue(
    stringValue(loadedContract?.name),
    remote.name,
    'expose name',
  );
  assertVersionValue(
    stringValue(compatibility.contractVersion),
    stringValue(backendFederation?.contractVersion),
    'expose contractVersion',
  );
  assertVersionValue(
    stringValue(compatibility.nodeAdapterVersion),
    stringValue(backendFederation?.nodeAdapterVersion),
    'expose nodeAdapterVersion',
  );
  assertVersionValue(
    stringValue(compatibility.packageName),
    stringValue(boundary?.packageName),
    'expose packageName',
  );
  assertVersionValue(
    stringValue(compatibility.build),
    stringValue(boundary?.buildVersion),
    'expose buildVersion',
  );

  const deliveryUnit = manifestDeliveryUnit(backendFederation, boundary);
  const manifestUnitId =
    stringValue(deliveryUnit.boundary?.unitId) ??
    stringValue(deliveryUnit.top?.unitId);
  const manifestBuildMarker = stringValue(deliveryUnit.boundary?.buildMarker);

  // Only enforced when both sides declare the field: absence on either side
  // is a legacy manifest/expose and must stay backward compatible.
  assertConsistentValue(
    manifestUnitId,
    stringValue(compatibility.unitId),
    'deliveryUnit.unitId vs expose compatibility.unitId',
  );
  assertConsistentValue(
    manifestBuildMarker,
    stringValue(compatibility.build),
    'deliveryUnit.buildMarker vs expose compatibility.build',
  );
}

function classifyLoadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (
    message.includes('strictEffectApproach') ||
    message.includes('runtimeFramework')
  ) {
    return 'strict_effect_required' as const;
  }

  return 'remote_unavailable' as const;
}

export async function loadBackendFederationManifest(
  options: Pick<
    BackendFederationManifestAdapterOptions,
    | 'env'
    | 'fetch'
    | 'manifest'
    | 'manifestEnv'
    | 'manifestPath'
    | 'manifestUrl'
    | 'timeoutMs'
  >,
): Promise<BackendFederationManifest> {
  if (options.manifest) {
    return options.manifest;
  }

  const reference = resolveManifestReference(options);
  if (!reference) {
    throw new BackendFederationManifestAdapterError(
      'manifest_unavailable',
      `[BFF][Effect] Backend federation manifest reference is missing. Pass manifest, manifestPath, manifestUrl, or manifestEnv for ${BACKEND_FEDERATION_MANIFEST_FILE}.`,
    );
  }

  try {
    const source = isHttpUrl(reference)
      ? await (async () => {
          const fetchManifest =
            options.fetch ??
            (globalThis.fetch as
              | ((
                  url: string,
                ) => Promise<BackendFederationManifestFetchResponse>)
              | undefined);
          if (!fetchManifest) {
            throw new BackendFederationManifestAdapterError(
              'manifest_unavailable',
              `[BFF][Effect] Backend federation manifest ${reference} requires a fetch implementation.`,
            );
          }

          const response = await withTimeout(
            fetchManifest(reference),
            options.timeoutMs,
            `Backend federation manifest ${reference}`,
          );
          if (!response.ok) {
            throw new BackendFederationManifestAdapterError(
              'manifest_unavailable',
              `[BFF][Effect] Backend federation manifest ${reference} returned HTTP ${response.status}${
                response.statusText ? ` ${response.statusText}` : ''
              }.`,
            );
          }

          return response.text();
        })()
      : await withTimeout(
          readFileReference(reference),
          options.timeoutMs,
          `Backend federation manifest ${reference}`,
        );
    const manifest = JSON.parse(source) as unknown;

    assertManifestAdapter(
      isRecord(manifest),
      'manifest_invalid',
      `[BFF][Effect] Backend federation manifest ${reference} must be a JSON object.`,
    );

    return manifest;
  } catch (error) {
    if (error instanceof BackendFederationManifestAdapterError) {
      throw error;
    }

    throw new BackendFederationManifestAdapterError(
      'manifest_unavailable',
      `[BFF][Effect] Backend federation manifest ${reference} could not be loaded.`,
      error,
    );
  }
}

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
  const remoteEntryUrl =
    remoteOverride.entry ??
    stringValue(backendFederation?.containerEntry) ??
    stringValue(entry?.url) ??
    resolveRemoteEntryFromMetadata(manifest);
  const remoteType =
    remoteOverride.type ??
    stringValue(backendFederation?.remoteType) ??
    stringValue(entry?.type) ??
    stringValue(remoteEntry?.type) ??
    'module';
  const expose =
    remoteOverride.expose ??
    stringValue(backendFederation?.expose) ??
    BACKEND_FEDERATION_EFFECT_EXPOSE;

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
    ...(remoteOverride.entryGlobalName
      ? { entryGlobalName: remoteOverride.entryGlobalName }
      : {}),
    expose,
    ...(remoteOverride.shareScope
      ? { shareScope: remoteOverride.shareScope }
      : {}),
  };
}

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

    const loaded = await withTimeout(
      loadBackendFederatedEffectApi({
        hostName: options.hostName,
        remote,
        ...(options.plugins ? { plugins: options.plugins } : {}),
        ...(options.runtime ? { runtime: options.runtime } : {}),
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
