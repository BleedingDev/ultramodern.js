// @effect-diagnostics processEnv:off strictBooleanExpressions:off
/**
 * Runtime for generated Effect API clients.
 *
 * `utils/effectClientGenerator` used to inline ~330 lines of untyped JS into
 * every generated client module. The generated module now shrinks to an
 * endpoint manifest plus one `createGeneratedEffectClient(...)` call into
 * this module, which is typed, lintable and unit-testable, and shipped once
 * instead of being duplicated into every consumer bundle.
 *
 * This module is bundled for the browser: no node builtins, no `effect`
 * imports.
 */
import {
  createDataBatchTransport,
  createRequestEnvelope,
  DEFAULT_DATA_BATCH_HEADER,
  DEFAULT_DATA_ENVELOPE_HEADER,
  encodeRequestEnvelopeHeader,
  type RequestEnvelope,
  type SelectionPlan,
  type TraceContext,
} from '../data-platform';

const METHODS_WITHOUT_BODY = new Set(['GET', 'DELETE', 'HEAD', 'OPTIONS']);
const DATA_REQUEST_MODES = new Set([
  'cache-first',
  'stale-while-revalidate',
  'network-only',
]);
const DATA_MUTATION_MODES = new Set([
  'optimistic',
  'pessimistic',
  'fire-and-forget',
]);

export type GeneratedEffectEndpoint = {
  apiId: string;
  group: string;
  endpoint: string;
  method: string;
  routePath: string;
  /** Per-endpoint operation contract hash (bff-core hash). */
  schemaHash: string;
  operationVersion: number;
};

export type GeneratedEffectBatchConfig = {
  enabled: boolean;
  endpoint: string;
  flushIntervalMs: number;
  maxBatchSize: number;
  maxBatchBytes: number;
  requestTimeoutMs: number;
  allowedMethods: string[];
};

export type GeneratedEffectClientConfig = {
  appNamespace: string;
  /** Cross-project producer id; absent for same-project clients. */
  requestId?: string;
  port: number;
  /** Resolve the port from process.env.PORT first (server bundles). */
  useEnvPort?: boolean;
  defaultOrigin: string;
  httpMethodDecider?: string;
  batch: GeneratedEffectBatchConfig;
};

export type EffectOperationDescriptor = {
  appNamespace: string;
  apiId: string;
  group: string;
  endpoint: string;
  operationId: string;
  routePath: string;
  method: string;
  operationVersion: number;
  schemaHash: string;
  version: number;
};

export type EffectClientOperation = (request?: unknown) => Promise<unknown>;
export type EffectClientGroup = Record<string, EffectClientOperation>;
export type EffectClient = Record<string, EffectClientGroup>;
export type EffectOperationManifest = Record<
  string,
  Record<string, EffectOperationDescriptor>
>;

export type EffectRequestContextInput = Record<string, unknown>;

export type EffectRequestContext = {
  headers: Record<string, string>;
} & Record<string, unknown>;

/** Structural slice of `@modern-js/create-request` the runtime relies on. */
export type EffectRequestRuntime = {
  createRequest: (options: {
    path: string;
    method: string;
    port: number | string;
    operationContext: Record<string, unknown>;
    httpMethodDecider: string;
    requestId?: string;
  }) => (...args: unknown[]) => Promise<unknown>;
  configure?: (options: Record<string, unknown>) => void;
  createRequestContextHeaders?: (
    input: EffectRequestContextInput,
  ) => Record<string, string>;
};

export type GeneratedEffectClientModule = {
  client: EffectClient;
  operationManifest: EffectOperationManifest;
  createEffectRequestContext: (
    requestContext: EffectRequestContextInput,
  ) => EffectRequestContext;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const stringOrUndefined = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const isDataRequestMode = (value: unknown) =>
  typeof value === 'string' && DATA_REQUEST_MODES.has(value);

const isDataMutationMode = (value: unknown) =>
  typeof value === 'string' && DATA_MUTATION_MODES.has(value);

const normalizeOrigin = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
};

const resolveRuntimeFetch = (): typeof fetch | undefined =>
  typeof fetch === 'function' ? fetch.bind(globalThis) : undefined;

/**
 * Resolves the current page origin with a configurable fallback. Single
 * implementation shared by the configure() bootstrap and the data envelope
 * (the generated template previously duplicated data-platform's
 * `resolveRuntimeOrigin` with a different fallback).
 */
const resolveOrigin = (defaultOrigin: string): string => {
  if (
    typeof window !== 'undefined' &&
    window.location &&
    typeof window.location.origin === 'string' &&
    window.location.origin
  ) {
    return window.location.origin;
  }

  const globalLocation = (
    globalThis as { location?: { origin?: unknown } } | undefined
  )?.location;
  if (
    globalLocation &&
    typeof globalLocation.origin === 'string' &&
    globalLocation.origin
  ) {
    return globalLocation.origin;
  }

  return defaultOrigin;
};

const normalizeRequest = (
  method: string,
  request: unknown,
): Record<string, unknown> => {
  if (!isRecord(request)) {
    return {};
  }

  const payload: Record<string, unknown> = { ...request };

  if (isRecord(request.path) && !isRecord(payload.params)) {
    payload.params = request.path;
  }

  if (isRecord(request.urlParams) && !isRecord(payload.query)) {
    payload.query = request.urlParams;
  }

  if (isRecord(request.headers) && !isRecord(payload.headers)) {
    payload.headers = request.headers;
  }

  if ('payload' in request && request.payload !== undefined) {
    if (
      typeof FormData !== 'undefined' &&
      request.payload instanceof FormData &&
      !('formData' in payload)
    ) {
      payload.formData = request.payload;
    } else if (METHODS_WITHOUT_BODY.has(method)) {
      if (isRecord(request.payload)) {
        payload.query = isRecord(payload.query)
          ? { ...payload.query, ...request.payload }
          : request.payload;
      } else if (!('body' in payload)) {
        payload.body = request.payload;
      }
    } else if (isRecord(request.payload) && !('data' in payload)) {
      payload.data = request.payload;
    } else if (!('body' in payload)) {
      payload.body = request.payload;
    }
  }

  return payload;
};

const resolveTargetOrigin = (
  dataPlatform: Record<string, unknown>,
  defaultOrigin: string,
): string => {
  const explicitTargetOrigin =
    stringOrUndefined(dataPlatform.targetOrigin) ||
    stringOrUndefined(dataPlatform.endpointOrigin);
  if (explicitTargetOrigin) {
    return explicitTargetOrigin;
  }
  return defaultOrigin;
};

const shouldAttachEnvelopeHeader = (
  dataPlatform: Record<string, unknown>,
  defaultOrigin: string,
): boolean => {
  if (dataPlatform.allowCrossOriginEnvelope === true) {
    return true;
  }
  const currentOrigin = normalizeOrigin(resolveOrigin(defaultOrigin));
  const targetOrigin = normalizeOrigin(
    resolveTargetOrigin(dataPlatform, defaultOrigin),
  );
  if (!currentOrigin || !targetOrigin) {
    return true;
  }
  return currentOrigin === targetOrigin;
};

const toEnvelopeInput = (
  normalizedRequest: Record<string, unknown>,
): Record<string, unknown> => {
  const payload: Record<string, unknown> = {};
  if (isRecord(normalizedRequest.params)) {
    payload.path = normalizedRequest.params;
  }
  if (isRecord(normalizedRequest.query)) {
    payload.query = normalizedRequest.query;
  }
  if ('data' in normalizedRequest && normalizedRequest.data !== undefined) {
    payload.data = normalizedRequest.data;
  }
  if ('body' in normalizedRequest && normalizedRequest.body !== undefined) {
    payload.body = normalizedRequest.body;
  }
  if (
    typeof FormData !== 'undefined' &&
    normalizedRequest.formData instanceof FormData
  ) {
    payload.formData = Array.from(normalizedRequest.formData.entries()).map(
      ([key, value]) => [key, String(value)],
    );
  }
  if (
    typeof URLSearchParams !== 'undefined' &&
    normalizedRequest.formUrlencoded instanceof URLSearchParams
  ) {
    payload.formUrlencoded = normalizedRequest.formUrlencoded.toString();
  }
  return payload;
};

export const createGeneratedEffectClient = (
  manifest: { endpoints: GeneratedEffectEndpoint[] },
  config: GeneratedEffectClientConfig,
  requestRuntime: EffectRequestRuntime,
): GeneratedEffectClientModule => {
  const createRequest = requestRuntime.createRequest;
  const configureRequest =
    typeof requestRuntime.configure === 'function'
      ? requestRuntime.configure
      : undefined;
  const createRequestContextHeaders =
    typeof requestRuntime.createRequestContextHeaders === 'function'
      ? requestRuntime.createRequestContextHeaders
      : undefined;

  const defaultOrigin = config.defaultOrigin;
  const httpMethodDecider = config.httpMethodDecider || 'functionName';
  const port =
    config.useEnvPort &&
    typeof process !== 'undefined' &&
    process.env &&
    process.env.PORT
      ? process.env.PORT
      : config.port;

  if (config.requestId && configureRequest) {
    const configurePayload: Record<string, unknown> = {
      requestId: config.requestId,
      requireEnvelope: true,
      identityBinding: {
        enabled: true,
        strict: true,
      },
      operationContract: {
        enabled: true,
        strict: true,
        requireSchemaHash: true,
        requireOperationVersion: true,
      },
      setDomain: () => resolveOrigin(defaultOrigin),
    };

    const runtimeFetch = resolveRuntimeFetch();
    if (config.batch.enabled !== false && runtimeFetch) {
      configurePayload.request = createDataBatchTransport({
        fetch: runtimeFetch,
        endpoint: config.batch.endpoint,
        flushIntervalMs: config.batch.flushIntervalMs,
        maxBatchSize: config.batch.maxBatchSize,
        maxBatchBytes: config.batch.maxBatchBytes,
        requestTimeoutMs: config.batch.requestTimeoutMs,
        allowedMethods: config.batch.allowedMethods,
      });
    }

    configureRequest(configurePayload);
  }

  const createEffectRequestContext = (
    requestContext: EffectRequestContextInput,
  ): EffectRequestContext => {
    if (!isRecord(requestContext)) {
      return {} as EffectRequestContext;
    }

    const headers = createRequestContextHeaders
      ? createRequestContextHeaders(requestContext)
      : {};

    return {
      ...requestContext,
      headers,
    };
  };

  const applyRequestContext = (
    normalizedRequest: Record<string, unknown>,
    request: unknown,
  ): Record<string, unknown> => {
    if (!isRecord(request) || !isRecord(request.requestContext)) {
      return normalizedRequest;
    }

    const requestContext = createEffectRequestContext(request.requestContext);
    const requestHeaders = isRecord(requestContext.headers)
      ? requestContext.headers
      : {};

    if (Object.keys(requestHeaders).length === 0) {
      return normalizedRequest;
    }

    return {
      ...normalizedRequest,
      headers: {
        ...requestHeaders,
        ...(isRecord(normalizedRequest.headers)
          ? normalizedRequest.headers
          : {}),
      },
    };
  };

  const prepareEffectRequest = (
    endpoint: GeneratedEffectEndpoint,
    operation: EffectOperationDescriptor,
    request: unknown,
  ): Record<string, unknown> => {
    const normalizedRequest = applyRequestContext(
      normalizeRequest(endpoint.method, request),
      request,
    );
    const dataPlatform =
      isRecord(request) && isRecord(request.dataPlatform)
        ? request.dataPlatform
        : {};
    const strictEnvelope =
      dataPlatform.requireEnvelope === true || dataPlatform.strict === true;

    if (
      !strictEnvelope &&
      !shouldAttachEnvelopeHeader(dataPlatform, defaultOrigin)
    ) {
      return normalizedRequest;
    }

    try {
      const namespace =
        stringOrUndefined(dataPlatform.appNamespace) || config.appNamespace;
      const origin =
        stringOrUndefined(dataPlatform.origin) || resolveOrigin(defaultOrigin);
      const envelope: RequestEnvelope = createRequestEnvelope({
        operation: {
          ...operation,
          appNamespace: namespace,
        },
        scope: {
          appNamespace: namespace,
          origin,
          tenantId: stringOrUndefined(dataPlatform.tenantId),
          userId: stringOrUndefined(dataPlatform.userId),
          sessionId: stringOrUndefined(dataPlatform.sessionId),
        },
        requestInput: {
          method: endpoint.method,
          routePath: endpoint.routePath,
          payload: toEnvelopeInput(normalizedRequest),
        },
        requestMode: isDataRequestMode(dataPlatform.requestMode)
          ? (dataPlatform.requestMode as RequestEnvelope['requestMode'])
          : undefined,
        mutationMode: isDataMutationMode(dataPlatform.mutationMode)
          ? (dataPlatform.mutationMode as RequestEnvelope['mutationMode'])
          : undefined,
        selectionPlan: isRecord(dataPlatform.selectionPlan)
          ? (dataPlatform.selectionPlan as SelectionPlan)
          : undefined,
        traceContext: isRecord(dataPlatform.traceContext)
          ? (dataPlatform.traceContext as unknown as TraceContext)
          : undefined,
        requireTraceContext: dataPlatform.requireTraceContext === true,
      });

      const headerName =
        stringOrUndefined(dataPlatform.envelopeHeader) ||
        DEFAULT_DATA_ENVELOPE_HEADER;
      const headers = isRecord(normalizedRequest.headers)
        ? { ...normalizedRequest.headers }
        : {};

      if (dataPlatform.batch === false) {
        headers[DEFAULT_DATA_BATCH_HEADER] = 'off';
      }

      headers[headerName] = encodeRequestEnvelopeHeader(envelope);

      return {
        ...normalizedRequest,
        headers,
      };
    } catch (error) {
      if (strictEnvelope) {
        throw error;
      }
      return normalizedRequest;
    }
  };

  const client: EffectClient = {};
  const operationManifest: EffectOperationManifest = {};

  for (const endpoint of manifest.endpoints) {
    const operationId = `${endpoint.method}:${endpoint.routePath}`;
    const operation: EffectOperationDescriptor = {
      appNamespace: config.appNamespace,
      apiId: endpoint.apiId,
      group: endpoint.group,
      endpoint: endpoint.endpoint,
      operationId,
      routePath: endpoint.routePath,
      method: endpoint.method,
      operationVersion: endpoint.operationVersion,
      schemaHash: endpoint.schemaHash,
      version: endpoint.operationVersion,
    };

    const sender = createRequest({
      path: endpoint.routePath,
      method: endpoint.method,
      port,
      operationContext: {
        operationId,
        routePath: endpoint.routePath,
        method: endpoint.method,
        schemaHash: endpoint.schemaHash,
        operationVersion: endpoint.operationVersion,
      },
      httpMethodDecider,
      ...(config.requestId ? { requestId: config.requestId } : {}),
    });

    const call: EffectClientOperation = (request: unknown = {}) =>
      sender(prepareEffectRequest(endpoint, operation, request));

    client[endpoint.group] ??= {};
    client[endpoint.group]![endpoint.endpoint] = call;
    operationManifest[endpoint.group] ??= {};
    operationManifest[endpoint.group]![endpoint.endpoint] = operation;
  }

  return {
    client,
    operationManifest,
    createEffectRequestContext,
  };
};
