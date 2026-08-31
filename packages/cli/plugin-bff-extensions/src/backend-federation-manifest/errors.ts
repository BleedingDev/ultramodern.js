// @effect-diagnostics asyncFunction:off extendsNativeError:off globalTimers:off newPromise:off strictBooleanExpressions:off

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

export function assertManifestAdapter(
  condition: unknown,
  code: BackendFederationManifestAdapterErrorCode,
  message: string,
): asserts condition {
  if (!condition) {
    throw new BackendFederationManifestAdapterError(code, message);
  }
}

export function assertVersionValue(
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

export function assertConsistentValue(
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
