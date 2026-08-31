const DEFAULT_MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_RESOURCE_BYTES = 1024 * 1024;
const DEFAULT_ENTRY_TIMEOUT_MS = 10_000;

export type BackendFederationRemoteEntryErrorCode =
  | 'aborted'
  | 'byte_length_mismatch'
  | 'entry_too_large'
  | 'fetch_failed'
  | 'identity_mismatch'
  | 'integrity_mismatch'
  | 'invalid_verification'
  | 'redirect_mismatch'
  | 'timeout'
  | 'unsupported_entry';

export class BackendFederationRemoteEntryError extends Error {
  readonly code: BackendFederationRemoteEntryErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: BackendFederationRemoteEntryErrorCode,
    message: string,
    options: {
      cause?: unknown;
      details?: Record<string, unknown>;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : options);
    this.name = 'BackendFederationRemoteEntryError';
    this.code = code;
    this.details = options.details;
  }
}

export type BackendFederationEntryIntegrity = {
  byteLength: number;
  sha256: string;
};

export type BackendFederationRemoteEntryVerification =
  BackendFederationEntryIntegrity & {
    buildMarker?: string;
    entryUrl: string;
    remoteName: string;
    unitId?: string;
  };

export type BackendFederationRemoteEntryExpectation =
  Partial<BackendFederationRemoteEntryVerification>;

export type BackendFederationRemoteEntry = {
  entry: string;
  name: string;
  type?: string;
};

export type BackendFederationEntryExports = {
  get: (
    id: string,
  ) =>
    | (() => Promise<unknown> | unknown)
    | Promise<() => Promise<unknown> | unknown>;
  init?: (...args: unknown[]) => void | Promise<void>;
};

export type BackendFederationResourceResponse = {
  body?: ReadableStream<Uint8Array> | null;
  headers?: { get(name: string): string | null };
  ok: boolean;
  status: number;
  statusText?: string;
  text?: () => Promise<string>;
  url?: string;
};

export type BackendFederationResourceFetch = (
  url: string,
  init?: RequestInit,
) => Promise<BackendFederationResourceResponse>;

export type BackendFederationRemoteEntryFetch = BackendFederationResourceFetch;

export type BackendFederationResourcePolicy = {
  allowInsecureHttp?: boolean;
  fetch?: BackendFederationResourceFetch;
  maxBytes?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type BackendFederationCommonJsEvaluator = (
  source: string,
  context: { remote: BackendFederationRemoteEntry },
) => unknown;

export type BackendFederationRemoteEntryPolicy =
  BackendFederationResourcePolicy & {
    evaluateCommonJs?: BackendFederationCommonJsEvaluator;
    expected?: BackendFederationRemoteEntryExpectation;
  };

export type LoadVerifiedBackendFederationEntryOptions =
  BackendFederationRemoteEntryPolicy & {
    remote: BackendFederationRemoteEntry;
    verification?: BackendFederationRemoteEntryVerification;
  };

export type LoadBoundedBackendFederationResourceOptions =
  BackendFederationResourcePolicy & {
    kind?: 'entry' | 'manifest';
  };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const recordField = (value: unknown, key: string) => {
  if (!isRecord(value)) {
    return undefined;
  }
  const field = value[key];
  return isRecord(field) ? field : undefined;
};

const stringField = (value: unknown) =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

export function resolveBackendFederationRemoteEntryVerification(
  manifest: unknown,
): BackendFederationRemoteEntryVerification | undefined {
  if (!isRecord(manifest)) {
    return undefined;
  }
  const entry = recordField(manifest, 'entry');
  const sha256 = entry?.sha256;
  const byteLength = entry?.byteLength;
  if (sha256 === undefined && byteLength === undefined) {
    return undefined;
  }
  const backendFederation = recordField(manifest, 'backendFederation');
  const boundary = recordField(backendFederation, 'versionBoundary');
  const boundaryDeliveryUnit = recordField(boundary, 'deliveryUnit');
  const deliveryUnit = recordField(backendFederation, 'deliveryUnit');
  const remoteName =
    stringField(backendFederation?.name) ??
    stringField(manifest.name) ??
    stringField(manifest.id);
  const entryUrl = stringField(entry?.url);
  const containerEntry = stringField(backendFederation?.containerEntry);

  if (
    typeof sha256 !== 'string' ||
    typeof byteLength !== 'number' ||
    remoteName === undefined ||
    entryUrl === undefined
  ) {
    throw new BackendFederationRemoteEntryError(
      'invalid_verification',
      '[Module Federation] Backend manifest entry verification requires remote name, entry.url, sha256, and byteLength.',
    );
  }
  if (
    containerEntry !== undefined &&
    canonicalEntryUrl(containerEntry).href !== canonicalEntryUrl(entryUrl).href
  ) {
    throw new BackendFederationRemoteEntryError(
      'identity_mismatch',
      '[Module Federation] Backend manifest containerEntry must match entry.url before remote execution.',
      {
        details: {
          containerEntry: redactBackendFederationUrl(containerEntry),
          entryUrl: redactBackendFederationUrl(entryUrl),
        },
      },
    );
  }
  const buildMarker =
    stringField(boundaryDeliveryUnit?.buildMarker) ??
    stringField(deliveryUnit?.buildMarker);
  const unitId =
    stringField(boundaryDeliveryUnit?.unitId) ??
    stringField(deliveryUnit?.unitId);

  return {
    byteLength,
    entryUrl,
    remoteName,
    sha256,
    ...(buildMarker ? { buildMarker } : {}),
    ...(unitId ? { unitId } : {}),
  };
}

const canonicalEntryUrl = (value: string) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new BackendFederationRemoteEntryError(
      'invalid_verification',
      '[Module Federation] Invalid backend federation URL.',
      { cause },
    );
  }
  if (url.username || url.password) {
    throw new BackendFederationRemoteEntryError(
      'invalid_verification',
      '[Module Federation] Backend remote entry URLs must not contain credentials.',
    );
  }
  url.hash = '';
  return url;
};

export function redactBackendFederationUrl(value: string) {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return '[local or invalid reference]';
  }
}

const isLoopback = (hostname: string) =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';

const assertAllowedEntryUrl = (url: URL, allowInsecureHttp: boolean) => {
  if (url.protocol === 'https:') {
    return;
  }
  if (
    url.protocol === 'http:' &&
    (allowInsecureHttp || isLoopback(url.hostname))
  ) {
    return;
  }
  throw new BackendFederationRemoteEntryError(
    'unsupported_entry',
    `[Module Federation] Backend federation resource ${redactBackendFederationUrl(url.href)} must use HTTPS (loopback HTTP is allowed for local development).`,
  );
};

const assertVerification = (
  remote: BackendFederationRemoteEntry,
  verification: BackendFederationRemoteEntryVerification,
  expected: BackendFederationRemoteEntryExpectation,
  allowInsecureHttp: boolean,
) => {
  if (remote.type !== undefined && remote.type !== 'commonjs-module') {
    throw new BackendFederationRemoteEntryError(
      'unsupported_entry',
      `[Module Federation] Verified backend remote ${remote.name} must be a self-contained CommonJS container.`,
    );
  }
  if (!/^[a-f0-9]{64}$/u.test(verification.sha256)) {
    throw new BackendFederationRemoteEntryError(
      'invalid_verification',
      '[Module Federation] Backend remote entry SHA-256 must be 64 lowercase hexadecimal characters.',
    );
  }
  if (
    !Number.isSafeInteger(verification.byteLength) ||
    verification.byteLength < 0
  ) {
    throw new BackendFederationRemoteEntryError(
      'invalid_verification',
      '[Module Federation] Backend remote entry byteLength must be a non-negative safe integer.',
    );
  }

  const requestedUrl = canonicalEntryUrl(remote.entry);
  const verifiedUrl = canonicalEntryUrl(verification.entryUrl);
  assertAllowedEntryUrl(requestedUrl, allowInsecureHttp);
  if (
    remote.name !== verification.remoteName ||
    requestedUrl.href !== verifiedUrl.href
  ) {
    throw new BackendFederationRemoteEntryError(
      'identity_mismatch',
      '[Module Federation] Backend remote name or entry URL does not match its verified identity.',
      {
        details: {
          requestedEntry: redactBackendFederationUrl(requestedUrl.href),
          requestedName: remote.name,
          verifiedEntry: redactBackendFederationUrl(verifiedUrl.href),
          verifiedName: verification.remoteName,
        },
      },
    );
  }

  for (const key of [
    'buildMarker',
    'byteLength',
    'entryUrl',
    'remoteName',
    'sha256',
    'unitId',
  ] as const) {
    const expectedValue = expected[key];
    if (expectedValue !== undefined && expectedValue !== verification[key]) {
      throw new BackendFederationRemoteEntryError(
        'identity_mismatch',
        `[Module Federation] Backend remote entry ${key} does not match the trusted expectation.`,
        {
          details: {
            expected:
              key === 'entryUrl' && typeof expectedValue === 'string'
                ? redactBackendFederationUrl(expectedValue)
                : expectedValue,
            field: key,
            received:
              key === 'entryUrl'
                ? redactBackendFederationUrl(verification.entryUrl)
                : verification[key],
          },
        },
      );
    }
  }

  return requestedUrl;
};

const resolveTrustedVerification = (
  verification: BackendFederationRemoteEntryVerification | undefined,
  expected: BackendFederationRemoteEntryExpectation,
) => {
  if (verification) {
    return verification;
  }
  if (
    typeof expected.byteLength === 'number' &&
    typeof expected.entryUrl === 'string' &&
    typeof expected.remoteName === 'string' &&
    typeof expected.sha256 === 'string'
  ) {
    return expected as BackendFederationRemoteEntryVerification;
  }
  throw new BackendFederationRemoteEntryError(
    'invalid_verification',
    '[Module Federation] Verified backend network loading requires trusted entryUrl, remoteName, sha256, and byteLength values.',
  );
};

const readWithAbort = <T>(promise: Promise<T>, signal: AbortSignal) =>
  new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });

const parseContentLength = (value: string | null) => {
  if (value === null || !/^\d+$/u.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

const sha256Hex = async (
  bytes: Uint8Array<ArrayBuffer>,
  signal: AbortSignal,
) => {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new BackendFederationRemoteEntryError(
      'unsupported_entry',
      '[Module Federation] Verified backend remote loading requires Web Crypto SHA-256 support.',
    );
  }
  const digest = new Uint8Array(
    await readWithAbort(subtle.digest('SHA-256', bytes), signal),
  );
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join(
    '',
  );
};

export async function loadBoundedBackendFederationResource(
  resourceUrl: string,
  options: LoadBoundedBackendFederationResourceOptions = {},
) {
  const requestedUrl = canonicalEntryUrl(resourceUrl);
  assertAllowedEntryUrl(requestedUrl, options.allowInsecureHttp === true);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_RESOURCE_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new BackendFederationRemoteEntryError(
      'invalid_verification',
      '[Module Federation] Backend federation resource maxBytes must be a positive safe integer.',
    );
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_ENTRY_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0) {
    throw new BackendFederationRemoteEntryError(
      'invalid_verification',
      '[Module Federation] Backend federation resource timeoutMs must be a non-negative safe integer.',
    );
  }

  const controller = new AbortController();
  let timedOut = false;
  let callerAborted = false;
  const onCallerAbort = () => {
    callerAborted = true;
    controller.abort(options.signal?.reason);
  };
  if (options.signal?.aborted) {
    onCallerAbort();
  } else {
    options.signal?.addEventListener('abort', onCallerAbort, { once: true });
  }
  const timeout =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort(
            new Error(
              `Backend federation ${options.kind ?? 'manifest'} timed out after ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs)
      : undefined;
  const fetchResource =
    options.fetch ??
    (globalThis.fetch as BackendFederationResourceFetch | undefined);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const resourceKind = options.kind ?? 'manifest';
  const cancellationError = (cause?: unknown) =>
    new BackendFederationRemoteEntryError(
      timedOut ? 'timeout' : 'aborted',
      timedOut
        ? `[Module Federation] Backend federation ${resourceKind} timed out after ${timeoutMs}ms.`
        : `[Module Federation] Backend federation ${resourceKind} loading was aborted.`,
      { cause },
    );

  try {
    if (controller.signal.aborted) {
      throw cancellationError(controller.signal.reason);
    }
    if (typeof fetchResource !== 'function') {
      throw new BackendFederationRemoteEntryError(
        'fetch_failed',
        `[Module Federation] Backend federation ${resourceKind} loading requires fetch.`,
      );
    }

    let response: BackendFederationResourceResponse;
    try {
      response = await readWithAbort(
        fetchResource(requestedUrl.href, {
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
        }),
        controller.signal,
      );
    } catch (cause) {
      if (controller.signal.aborted) {
        throw cancellationError(cause);
      }
      throw new BackendFederationRemoteEntryError(
        'fetch_failed',
        `[Module Federation] Failed to fetch backend federation ${resourceKind}.`,
        { cause },
      );
    }
    if (!response.ok) {
      throw new BackendFederationRemoteEntryError(
        'fetch_failed',
        `[Module Federation] Backend federation ${resourceKind} returned HTTP ${response.status}.`,
      );
    }
    if (response.url) {
      const responseUrl = canonicalEntryUrl(response.url);
      if (responseUrl.href !== requestedUrl.href) {
        throw new BackendFederationRemoteEntryError(
          'redirect_mismatch',
          `[Module Federation] Backend federation ${resourceKind} redirected outside its trusted URL.`,
          {
            details: {
              expected: redactBackendFederationUrl(requestedUrl.href),
              received: redactBackendFederationUrl(responseUrl.href),
            },
          },
        );
      }
    }

    const contentLength = parseContentLength(
      response.headers?.get('content-length') ?? null,
    );
    if (contentLength !== undefined && contentLength > maxBytes) {
      controller.abort();
      await response.body?.cancel().catch(() => undefined);
      throw new BackendFederationRemoteEntryError(
        'entry_too_large',
        `[Module Federation] Backend federation ${resourceKind} declares ${contentLength} bytes, exceeding its ${maxBytes}-byte policy limit.`,
      );
    }

    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    if (response.body) {
      reader = response.body.getReader();
      while (true) {
        const result = await readWithAbort(reader.read(), controller.signal);
        if (result.done) {
          break;
        }
        byteLength += result.value.byteLength;
        if (byteLength > maxBytes) {
          throw new BackendFederationRemoteEntryError(
            'entry_too_large',
            `[Module Federation] Backend federation ${resourceKind} exceeded its ${maxBytes}-byte limit while streaming.`,
          );
        }
        chunks.push(result.value);
      }
    } else if (response.text) {
      const bytes = new TextEncoder().encode(
        await readWithAbort(response.text(), controller.signal),
      );
      if (bytes.byteLength > maxBytes) {
        throw new BackendFederationRemoteEntryError(
          'entry_too_large',
          `[Module Federation] Backend federation ${resourceKind} exceeded its ${maxBytes}-byte limit.`,
        );
      }
      chunks.push(bytes);
      byteLength = bytes.byteLength;
    }

    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (controller.signal.aborted) {
      throw cancellationError(controller.signal.reason);
    }
    return bytes;
  } catch (cause) {
    if (!controller.signal.aborted) {
      controller.abort(cause);
    }
    await reader?.cancel(cause).catch(() => undefined);
    if (cause instanceof BackendFederationRemoteEntryError) {
      throw cause;
    }
    if (timedOut || callerAborted) {
      throw cancellationError(cause);
    }
    throw new BackendFederationRemoteEntryError(
      'fetch_failed',
      `[Module Federation] Backend federation ${resourceKind} loading failed.`,
      { cause },
    );
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    options.signal?.removeEventListener('abort', onCallerAbort);
  }
}

export const evaluateBackendFederationCommonJsEntry = (
  remote: BackendFederationRemoteEntry,
  bytes: Uint8Array,
  evaluator?: BackendFederationCommonJsEvaluator,
) => {
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new BackendFederationRemoteEntryError(
      'integrity_mismatch',
      `[Module Federation] Backend remote ${remote.name} is not valid UTF-8 JavaScript.`,
      { cause },
    );
  }

  if (evaluator === undefined) {
    throw new BackendFederationRemoteEntryError(
      'unsupported_entry',
      `[Module Federation] Backend remote ${remote.name} requires an explicit runtime evaluator. Node callers should use the Node security subpath; edge callers should use a service binding or native module provider.`,
    );
  }
  const evaluated = evaluator(source, { remote });
  const defaultExport =
    typeof evaluated === 'object' &&
    evaluated !== null &&
    'default' in evaluated
      ? evaluated.default
      : undefined;
  const entry = defaultExport ?? evaluated;
  if (
    typeof entry !== 'object' ||
    entry === null ||
    typeof (entry as Partial<BackendFederationEntryExports>).get !== 'function'
  ) {
    throw new BackendFederationRemoteEntryError(
      'fetch_failed',
      `[Module Federation] Backend remote ${remote.name} did not evaluate to a container entry.`,
    );
  }
  return entry as BackendFederationEntryExports;
};

export async function loadVerifiedBackendFederationEntry(
  options: LoadVerifiedBackendFederationEntryOptions,
): Promise<BackendFederationEntryExports> {
  const verification = resolveTrustedVerification(
    options.verification,
    options.expected ?? {},
  );
  const requestedUrl = assertVerification(
    options.remote,
    verification,
    options.expected ?? {},
    options.allowInsecureHttp === true,
  );
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_ENTRY_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new BackendFederationRemoteEntryError(
      'invalid_verification',
      '[Module Federation] Backend remote entry maxBytes must be a positive safe integer.',
    );
  }
  if (verification.byteLength > maxBytes) {
    throw new BackendFederationRemoteEntryError(
      'entry_too_large',
      `[Module Federation] Backend remote entry exceeds the ${maxBytes}-byte policy limit.`,
    );
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_ENTRY_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0) {
    throw new BackendFederationRemoteEntryError(
      'invalid_verification',
      '[Module Federation] Backend remote entry timeoutMs must be a non-negative safe integer.',
    );
  }
  const controller = new AbortController();
  let timedOut = false;
  let callerAborted = false;
  const onCallerAbort = () => {
    callerAborted = true;
    controller.abort(options.signal?.reason);
  };
  if (options.signal?.aborted) {
    onCallerAbort();
  } else {
    options.signal?.addEventListener('abort', onCallerAbort, { once: true });
  }
  const timeout =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort(
            new Error(`Backend remote entry timed out after ${timeoutMs}ms`),
          );
        }, timeoutMs)
      : undefined;
  const fetchEntry = options.fetch ?? globalThis.fetch;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  const cancellationError = (cause?: unknown) =>
    new BackendFederationRemoteEntryError(
      timedOut ? 'timeout' : 'aborted',
      timedOut
        ? `[Module Federation] Backend remote ${options.remote.name} timed out after ${timeoutMs}ms.`
        : `[Module Federation] Backend remote ${options.remote.name} loading was aborted.`,
      { cause },
    );

  try {
    if (controller.signal.aborted) {
      throw cancellationError(controller.signal.reason);
    }
    if (typeof fetchEntry !== 'function') {
      throw new BackendFederationRemoteEntryError(
        'fetch_failed',
        '[Module Federation] Backend remote entry loading requires fetch.',
      );
    }

    let response: BackendFederationResourceResponse;
    try {
      response = await readWithAbort(
        fetchEntry(requestedUrl.href, {
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
        }),
        controller.signal,
      );
    } catch (cause) {
      if (controller.signal.aborted) {
        throw cancellationError(cause);
      }
      throw new BackendFederationRemoteEntryError(
        'fetch_failed',
        `[Module Federation] Failed to fetch backend remote ${options.remote.name}.`,
        { cause },
      );
    }
    if (!response.ok) {
      throw new BackendFederationRemoteEntryError(
        'fetch_failed',
        `[Module Federation] Backend remote ${options.remote.name} returned HTTP ${response.status}.`,
      );
    }
    if (response.url) {
      const responseUrl = canonicalEntryUrl(response.url);
      if (responseUrl.href !== requestedUrl.href) {
        throw new BackendFederationRemoteEntryError(
          'redirect_mismatch',
          `[Module Federation] Backend remote ${options.remote.name} redirected outside its verified entry URL.`,
          {
            details: {
              expected: redactBackendFederationUrl(requestedUrl.href),
              received: redactBackendFederationUrl(responseUrl.href),
            },
          },
        );
      }
    }

    const contentLength = parseContentLength(
      response.headers?.get('content-length') ?? null,
    );
    const byteLimit = Math.min(maxBytes, verification.byteLength);
    if (contentLength !== undefined && contentLength > maxBytes) {
      controller.abort();
      await response.body?.cancel().catch(() => undefined);
      throw new BackendFederationRemoteEntryError(
        'entry_too_large',
        `[Module Federation] Backend remote ${options.remote.name} declares ${contentLength} bytes, exceeding its ${maxBytes}-byte policy limit.`,
      );
    }

    reader = response.body?.getReader();
    const bytes = new Uint8Array(verification.byteLength);
    let byteLength = 0;
    if (reader) {
      while (true) {
        const result = await readWithAbort(reader.read(), controller.signal);
        if (result.done) {
          break;
        }
        const nextByteLength = byteLength + result.value.byteLength;
        if (nextByteLength > byteLimit) {
          throw new BackendFederationRemoteEntryError(
            'entry_too_large',
            `[Module Federation] Backend remote ${options.remote.name} exceeded its ${byteLimit}-byte limit while streaming.`,
          );
        }
        bytes.set(result.value, byteLength);
        byteLength = nextByteLength;
      }
    }

    if (byteLength !== verification.byteLength) {
      throw new BackendFederationRemoteEntryError(
        'byte_length_mismatch',
        `[Module Federation] Backend remote ${options.remote.name} byte length mismatch.`,
        {
          details: {
            expected: verification.byteLength,
            received: byteLength,
          },
        },
      );
    }
    const actualDigest = await sha256Hex(bytes, controller.signal);
    if (controller.signal.aborted) {
      throw cancellationError(controller.signal.reason);
    }
    if (actualDigest !== verification.sha256) {
      throw new BackendFederationRemoteEntryError(
        'integrity_mismatch',
        `[Module Federation] Backend remote ${options.remote.name} SHA-256 mismatch.`,
        {
          details: {
            expected: verification.sha256,
            received: actualDigest,
          },
        },
      );
    }

    return evaluateBackendFederationCommonJsEntry(
      options.remote,
      bytes,
      options.evaluateCommonJs,
    );
  } catch (cause) {
    if (!controller.signal.aborted) {
      controller.abort(cause);
    }
    await reader?.cancel(cause).catch(() => undefined);
    if (
      cause instanceof BackendFederationRemoteEntryError &&
      !(cause.code === 'aborted' && timedOut)
    ) {
      throw cause;
    }
    if (controller.signal.aborted && (timedOut || callerAborted)) {
      throw cancellationError(cause);
    }
    throw cause;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    options.signal?.removeEventListener('abort', onCallerAbort);
  }
}
