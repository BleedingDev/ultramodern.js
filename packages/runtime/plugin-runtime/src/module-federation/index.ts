// @effect-diagnostics asyncFunction:off extendsNativeError:off globalFetch:off strictBooleanExpressions:off

export * from './consume-surface';
export * from './last-known-good';
export * from './surface-resolution-types';

export const MODULE_FEDERATION_FALLBACK_SIGNAL_EVENT =
  'modernjs:mf-runtime-fallback';

export const MODULE_FEDERATION_RECOVERY_SIGNAL_EVENT =
  'modernjs:mf-runtime-recovery';

export const DEFAULT_RUNTIME_FALLBACK_SIGNAL_ENDPOINT =
  '/_modern/contract-gates/runtime-fallback';

export const DEFAULT_RUNTIME_FALLBACK_SIGNAL_AUTH_HEADER =
  'x-modernjs-runtime-signal-token';

export type ModuleFederationFallbackClassification =
  | 'timeout'
  | 'network'
  | 'contract'
  | 'version-skew'
  | 'remote-unavailable';

export type ModuleFederationFallbackStatus =
  | 'degraded'
  | 'failed'
  | 'recovered';

export type ModuleFederationFallbackTelemetryInput = {
  appName: string;
  classification: ModuleFederationFallbackClassification;
  entry?: string;
  error?: unknown;
  eventName?: string;
  exportName?: string;
  metadata?: Record<string, unknown>;
  phase: 'discovery' | 'load' | 'mount' | 'hydrate' | 'recover';
  remote: string;
  runtimeDigest?: string;
  status?: ModuleFederationFallbackStatus;
};

export type ModuleFederationFallbackTelemetryPayload = {
  appName: string;
  entry?: string;
  eventName: string;
  phase: ModuleFederationFallbackTelemetryInput['phase'];
  reason: ModuleFederationFallbackClassification;
  runtimeDigest?: string;
  schemaVersion: 1;
  metadata: {
    classification: ModuleFederationFallbackClassification;
    errorMessage?: string;
    errorName?: string;
    exportName?: string;
    remote: string;
    runtimeDigest?: string;
    status: ModuleFederationFallbackStatus;
  } & Record<string, unknown>;
};

export type ModuleFederationFallbackTelemetryEmitOptions = {
  authHeaderName?: string;
  authToken?: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  postSignal?: boolean;
};

export type ModuleFederationFallbackTelemetryEmitResult = {
  dispatched: boolean;
  posted: boolean;
  postStatus?: number;
};

export class ModuleFederationRemoteLoadTimeoutError extends Error {
  constructor(remote: string, timeoutMs: number) {
    super(`Loading remote "${remote}" timed out after ${timeoutMs}ms`);
    this.name = 'ModuleFederationRemoteLoadTimeoutError';
  }
}

export class ModuleFederationRemoteLoadError extends Error {
  readonly remote: string;
  readonly attempts: number;
  readonly causeError: Error;

  constructor(remote: string, attempts: number, causeError: Error) {
    super(
      `Unable to load remote "${remote}" after ${attempts} attempt${
        attempts > 1 ? 's' : ''
      }: ${causeError.message}`,
    );
    this.name = 'ModuleFederationRemoteLoadError';
    this.remote = remote;
    this.attempts = attempts;
    this.causeError = causeError;
  }
}

export class ModuleFederationRemoteComponentContractError extends Error {
  constructor(remote: string, exportName: string) {
    super(
      `Remote "${remote}" export "${exportName}" is not a valid React component`,
    );
    this.name = 'ModuleFederationRemoteComponentContractError';
  }
}

function toError(error: unknown) {
  if (error instanceof Error) {
    return error;
  }

  return new Error(
    typeof error === 'string' ? error : 'Unknown remote load error',
  );
}

export function classifyModuleFederationFallback(
  error: unknown,
): ModuleFederationFallbackClassification {
  const normalizedError = toError(error);
  if (normalizedError instanceof ModuleFederationRemoteLoadError) {
    return classifyModuleFederationFallback(normalizedError.causeError);
  }
  if (normalizedError instanceof ModuleFederationRemoteLoadTimeoutError) {
    return 'timeout';
  }
  if (normalizedError instanceof ModuleFederationRemoteComponentContractError) {
    return 'contract';
  }

  const message = normalizedError.message;
  if (
    /version|requiredVersion|singleton|share scope|shared module/i.test(message)
  ) {
    return 'version-skew';
  }
  if (/network|fetch|script|timeout|chunk|loading/i.test(message)) {
    return 'network';
  }

  return 'remote-unavailable';
}

export function createModuleFederationFallbackTelemetry(
  input: ModuleFederationFallbackTelemetryInput,
): ModuleFederationFallbackTelemetryPayload {
  const error = input.error !== undefined ? toError(input.error) : undefined;
  const status = input.status ?? 'degraded';
  const eventName =
    input.eventName ??
    (status === 'recovered'
      ? MODULE_FEDERATION_RECOVERY_SIGNAL_EVENT
      : MODULE_FEDERATION_FALLBACK_SIGNAL_EVENT);
  const metadata: ModuleFederationFallbackTelemetryPayload['metadata'] = {
    ...(input.metadata ?? {}),
    classification: input.classification,
    remote: input.remote,
    status,
  };

  if (input.exportName !== undefined) {
    metadata.exportName = input.exportName;
  }
  if (input.runtimeDigest !== undefined) {
    metadata.runtimeDigest = input.runtimeDigest;
  }
  if (error !== undefined) {
    metadata.errorName = error.name;
    metadata.errorMessage = error.message;
  }

  const payload: ModuleFederationFallbackTelemetryPayload = {
    appName: input.appName,
    eventName,
    metadata,
    phase: input.phase,
    reason: input.classification,
    schemaVersion: 1,
  };

  if (input.entry !== undefined) {
    payload.entry = input.entry;
  }
  if (input.runtimeDigest !== undefined) {
    payload.runtimeDigest = input.runtimeDigest;
  }

  return payload;
}

export function toModuleFederationFallbackAttributes(
  payload: ModuleFederationFallbackTelemetryPayload,
): Record<string, string> {
  return {
    'data-mf-fallback-app': payload.appName,
    'data-mf-fallback-classification': payload.reason,
    'data-mf-fallback-phase': payload.phase,
    'data-mf-fallback-remote': String(payload.metadata.remote),
    'data-mf-fallback-status': String(payload.metadata.status),
    'data-mf-telemetry-event': payload.eventName,
  };
}

export async function emitModuleFederationFallbackTelemetry(
  input: ModuleFederationFallbackTelemetryInput,
  options: ModuleFederationFallbackTelemetryEmitOptions = {},
): Promise<ModuleFederationFallbackTelemetryEmitResult> {
  const payload = createModuleFederationFallbackTelemetry(input);

  if (
    typeof window !== 'undefined' &&
    typeof window.dispatchEvent === 'function' &&
    typeof CustomEvent !== 'undefined'
  ) {
    window.dispatchEvent(
      new CustomEvent(payload.eventName, {
        detail: payload,
      }),
    );
  }

  const shouldPost = options.postSignal === true || Boolean(options.endpoint);
  if (!shouldPost) {
    return {
      dispatched: true,
      posted: false,
    };
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return {
      dispatched: true,
      posted: false,
    };
  }

  const headers = new Headers({
    'content-type': 'application/json',
  });
  if (options.authToken !== undefined && options.authToken.length > 0) {
    headers.set(
      options.authHeaderName ?? DEFAULT_RUNTIME_FALLBACK_SIGNAL_AUTH_HEADER,
      options.authToken,
    );
  }

  const response = await fetchImpl(
    options.endpoint ?? DEFAULT_RUNTIME_FALLBACK_SIGNAL_ENDPOINT,
    {
      body: JSON.stringify(payload),
      headers,
      method: 'POST',
      keepalive: true,
    },
  );

  return {
    dispatched: true,
    posted: true,
    postStatus: response.status,
  };
}
