// @effect-diagnostics asyncFunction:off nodeBuiltinImport:off processEnv:off strictBooleanExpressions:off
import {
  createOperationEntries,
  createOperationSchemaHash,
  DEFAULT_OPERATION_VERSION,
} from '@modern-js/bff-core';
import type { HttpMethodDecider } from '@modern-js/types';
import { compatibleRequire, findExists, fs, logger } from '@modern-js/utils';
import path from 'path';

const JS_OR_TS_EXTS = [
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.mts',
  '.cjs',
  '.cts',
] as const;

const DEFAULT_REQUEST_CREATOR = '@modern-js/plugin-bff/client';
const DEFAULT_DATA_PLATFORM_IMPORT = '@modern-js/plugin-bff/data-platform';
type EffectEndpointMeta = {
  apiId: string;
  groupName: string;
  endpointName: string;
  method: string;
  routePath: string;
};

type HttpApiLike = {
  identifier?: unknown;
};

type HttpApiGroupLike = {
  identifier?: unknown;
};

type HttpApiEndpointLike = {
  name?: unknown;
  method?: unknown;
  path?: unknown;
};

type HttpApiRuntime = {
  isHttpApi: (value: unknown) => boolean;
  reflect: (
    api: unknown,
    handlers: {
      onGroup?: (group: HttpApiGroupLike) => void;
      onEndpoint: (input: {
        group: HttpApiGroupLike;
        endpoint: HttpApiEndpointLike;
      }) => void;
    },
  ) => void;
};

let httpApiRuntimePromise: Promise<HttpApiRuntime> | undefined;

export type EffectClientCodegenOptions = {
  appDir: string;
  apiDir: string;
  resourcePath: string;
  prefix: string;
  port: number;
  target?: string;
  requestCreator?: string;
  httpMethodDecider?: HttpMethodDecider;
  dataPlatformBatch?: {
    enabled?: boolean;
    endpoint?: string;
    flushIntervalMs?: number;
    maxBatchSize?: number;
    maxBatchBytes?: number;
    requestTimeoutMs?: number;
    allowedMethods?: string[];
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function ensureLeadingSlash(pathname: string) {
  return pathname.startsWith('/') ? pathname : `/${pathname}`;
}

function normalizePrefix(prefix: string) {
  if (prefix === '/') {
    return '';
  }
  return ensureLeadingSlash(prefix || '/api');
}

function isAbsoluteUrl(value: string) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function resolveBatchEndpoint(prefix: string, endpoint: string | undefined) {
  const value = endpoint || '/_data/batch';
  if (isAbsoluteUrl(value)) {
    return value;
  }

  const normalizedPrefix = normalizePrefix(prefix);
  const normalizedEndpoint = ensureLeadingSlash(value);
  if (!normalizedPrefix) {
    return normalizedEndpoint;
  }

  if (
    normalizedEndpoint === normalizedPrefix ||
    normalizedEndpoint.startsWith(`${normalizedPrefix}/`)
  ) {
    return normalizedEndpoint;
  }

  return `${normalizedPrefix}${normalizedEndpoint === '/' ? '' : normalizedEndpoint}`;
}

function getRoutePath(prefix: string, endpointPath: string) {
  const normalizedPrefix = normalizePrefix(prefix);
  const normalizedEndpointPath = ensureLeadingSlash(endpointPath);
  const finalEndpointPath = normalizedEndpointPath === '/' ? '' : endpointPath;
  if (!normalizedPrefix && !finalEndpointPath) {
    return '/';
  }
  return `${normalizedPrefix}${finalEndpointPath || ''}`;
}

function toSafeIdentifier(name: string) {
  const sanitized = name.replace(/[^a-zA-Z0-9_$]/g, '_');
  if (!sanitized) {
    return '_';
  }
  if (/^[0-9]/.test(sanitized)) {
    return `_${sanitized}`;
  }
  return sanitized;
}

function getPackageName(appDir: string): string | undefined {
  try {
    const packageJsonPath = path.resolve(appDir, './package.json');
    const packageJson = fs.readJSONSync(packageJsonPath) as {
      name?: string;
    };
    return packageJson.name;
  } catch {
    return undefined;
  }
}

async function getHttpApiRuntime(): Promise<HttpApiRuntime> {
  if (!httpApiRuntimePromise) {
    httpApiRuntimePromise = (async () => {
      let mod: unknown;
      try {
        mod = await compatibleRequire('effect/unstable/httpapi', false);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("Cannot find module 'effect/unstable/httpapi'")) {
          throw error;
        }
        // Fallback for CJS paths where the effect package does not expose a require condition.
        const effectPackageJson = require.resolve('effect/package.json');
        const effectHttpApiRuntimePath = path.join(
          path.dirname(effectPackageJson),
          'dist',
          'unstable',
          'httpapi',
          'index.js',
        );
        mod = await compatibleRequire(effectHttpApiRuntimePath, false);
      }

      if (isRecord(mod) && isRecord(mod.HttpApi)) {
        const maybeHttpApi = mod.HttpApi as Partial<HttpApiRuntime>;
        if (
          typeof maybeHttpApi.isHttpApi === 'function' &&
          typeof maybeHttpApi.reflect === 'function'
        ) {
          return maybeHttpApi as HttpApiRuntime;
        }
      }
      throw new Error(
        '[BFF][Effect] Unable to resolve HttpApi runtime from effect/unstable/httpapi.',
      );
    })();
  }

  return httpApiRuntimePromise;
}

function resolveApiId(api: HttpApiLike): string {
  const fallback = 'EffectHttpApi';
  const maybeApi = api as HttpApiLike;
  if (
    'identifier' in maybeApi &&
    typeof maybeApi.identifier === 'string' &&
    maybeApi.identifier
  ) {
    return maybeApi.identifier;
  }
  return fallback;
}

function collectEffectEndpoints(
  httpApiRuntime: HttpApiRuntime,
  api: HttpApiLike,
  prefix: string,
) {
  const endpoints: EffectEndpointMeta[] = [];
  const apiId = resolveApiId(api);
  httpApiRuntime.reflect(api, {
    onGroup: () => {
      // no-op
    },
    onEndpoint: ({
      group,
      endpoint,
    }: {
      group: HttpApiGroupLike;
      endpoint: HttpApiEndpointLike;
    }) => {
      endpoints.push({
        apiId,
        groupName: String(group.identifier),
        endpointName: String(endpoint.name),
        method: String(endpoint.method).toUpperCase(),
        routePath: getRoutePath(prefix, String(endpoint.path)),
      });
    },
  });
  return endpoints.sort((a, b) => {
    if (a.groupName === b.groupName) {
      return a.endpointName.localeCompare(b.endpointName);
    }
    return a.groupName.localeCompare(b.groupName);
  });
}

async function loadEffectApi(
  resourcePath: string,
): Promise<HttpApiLike | null> {
  const httpApiRuntime = await getHttpApiRuntime();
  const mod = (await compatibleRequire(resourcePath, false)) as unknown;

  if (isRecord(mod) && httpApiRuntime.isHttpApi(mod.api)) {
    return mod.api as HttpApiLike;
  }

  if (
    isRecord(mod) &&
    isRecord(mod.default) &&
    httpApiRuntime.isHttpApi(mod.default.api)
  ) {
    return mod.default.api as HttpApiLike;
  }

  if (
    isRecord(mod) &&
    typeof mod.default === 'function' &&
    mod.default.length === 0
  ) {
    const output = await mod.default();
    if (isRecord(output) && httpApiRuntime.isHttpApi(output.api)) {
      return output.api as HttpApiLike;
    }
  }

  return null;
}

function renderEffectClientCode(
  endpoints: EffectEndpointMeta[],
  options: EffectClientCodegenOptions,
) {
  const senderDeclarations: string[] = [];
  const operationDeclarations: string[] = [];
  const callerDeclarations: string[] = [];
  const groupedCallers: Record<
    string,
    Array<{ endpointName: string; callVar: string }>
  > = {};
  const groupedOperations: Record<
    string,
    Array<{ endpointName: string; operationVar: string }>
  > = {};

  const requestCreator = options.requestCreator || DEFAULT_REQUEST_CREATOR;
  const dataPlatformImport = DEFAULT_DATA_PLATFORM_IMPORT;
  const httpMethodDecider = options.httpMethodDecider || 'functionName';
  const portCode =
    options.target === 'server'
      ? `process.env.PORT || ${String(options.port)}`
      : String(options.port);
  const packageName = getPackageName(options.appDir);
  const dataPlatformAppNamespace = packageName || 'unknown-app';
  const requestId =
    options.target === 'bundle'
      ? packageName || process.env.npm_package_name
      : undefined;
  const normalizedRequestId = requestId || 'default';
  const operationVersion =
    typeof DEFAULT_OPERATION_VERSION === 'number'
      ? DEFAULT_OPERATION_VERSION
      : 1;
  const schemaHash = createOperationSchemaHash(
    createOperationEntries(
      endpoints.map(endpoint => ({
        name: endpoint.endpointName,
        httpMethod: endpoint.method,
        routePath: endpoint.routePath,
      })),
    ),
    normalizedRequestId,
  );
  const batchConfig = options.dataPlatformBatch;
  const batchEndpoint = resolveBatchEndpoint(
    options.prefix,
    batchConfig?.endpoint,
  );
  const batchConfigCode = JSON.stringify({
    enabled: batchConfig?.enabled ?? true,
    endpoint: batchEndpoint,
    flushIntervalMs: batchConfig?.flushIntervalMs ?? 8,
    maxBatchSize: batchConfig?.maxBatchSize ?? 16,
    maxBatchBytes: batchConfig?.maxBatchBytes ?? 64 * 1024,
    requestTimeoutMs: batchConfig?.requestTimeoutMs ?? 10_000,
    allowedMethods:
      batchConfig?.allowedMethods && batchConfig.allowedMethods.length > 0
        ? batchConfig.allowedMethods
        : ['GET'],
  });

  endpoints.forEach((endpoint, index) => {
    const senderVar = `__sender_${toSafeIdentifier(endpoint.groupName)}_${toSafeIdentifier(endpoint.endpointName)}_${index}`;
    const callVar = `__call_${toSafeIdentifier(endpoint.groupName)}_${toSafeIdentifier(endpoint.endpointName)}_${index}`;
    const operationVar = `__operation_${toSafeIdentifier(endpoint.groupName)}_${toSafeIdentifier(endpoint.endpointName)}_${index}`;
    const operationId = `${endpoint.method}:${endpoint.routePath}`;
    const operationContextCode = JSON.stringify({
      operationId,
      routePath: endpoint.routePath,
      method: endpoint.method,
      schemaHash,
      operationVersion,
    });

    const createRequestOptions = `{
      path: ${JSON.stringify(endpoint.routePath)},
      method: ${JSON.stringify(endpoint.method)},
      port: ${portCode},
      operationContext: ${operationContextCode},
      httpMethodDecider: ${JSON.stringify(httpMethodDecider)}${
        requestId ? `, requestId: ${JSON.stringify(requestId)}` : ''
      }
    }`.replace(/\n\s*/g, '');

    senderDeclarations.push(
      `const ${senderVar} = createRequest(${createRequestOptions});`,
    );
    operationDeclarations.push(
      `const ${operationVar} = ${JSON.stringify({
        appNamespace: dataPlatformAppNamespace,
        apiId: endpoint.apiId,
        group: endpoint.groupName,
        endpoint: endpoint.endpointName,
        operationId,
        routePath: endpoint.routePath,
        method: endpoint.method,
        operationVersion,
        schemaHash,
        version: operationVersion,
      })};`,
    );
    callerDeclarations.push(
      `const ${callVar} = (request = {}) => ${senderVar}(__prepareEffectRequest(${JSON.stringify(endpoint.method)}, ${JSON.stringify(endpoint.routePath)}, ${operationVar}, request));`,
    );

    groupedCallers[endpoint.groupName] ??= [];
    groupedCallers[endpoint.groupName].push({
      endpointName: endpoint.endpointName,
      callVar,
    });
    groupedOperations[endpoint.groupName] ??= [];
    groupedOperations[endpoint.groupName].push({
      endpointName: endpoint.endpointName,
      operationVar,
    });
  });

  const groupObjectEntries = Object.entries(groupedCallers).map(
    ([groupName, groupCallers]) => {
      const endpointEntries = groupCallers
        .map(
          caller => `${JSON.stringify(caller.endpointName)}: ${caller.callVar}`,
        )
        .join(', ');
      return `${JSON.stringify(groupName)}: { ${endpointEntries} }`;
    },
  );

  const clientObject = groupObjectEntries.length
    ? `{
  ${groupObjectEntries.join(',\n  ')}
}`
    : '{}';

  const operationManifestEntries = Object.entries(groupedOperations).map(
    ([groupName, groupOperations]) => {
      const endpointEntries = groupOperations
        .map(
          operation =>
            `${JSON.stringify(operation.endpointName)}: ${operation.operationVar}`,
        )
        .join(', ');
      return `${JSON.stringify(groupName)}: { ${endpointEntries} }`;
    },
  );

  const operationManifestObject = operationManifestEntries.length
    ? `{
  ${operationManifestEntries.join(',\n  ')}
}`
    : '{}';

  return `import * as __requestRuntime from ${JSON.stringify(requestCreator)};
import {
  createDataBatchTransport,
  DEFAULT_DATA_BATCH_HEADER,
  DEFAULT_DATA_ENVELOPE_HEADER,
  createRequestEnvelope,
  encodeRequestEnvelopeHeader,
} from ${JSON.stringify(dataPlatformImport)};

const createRequest = __requestRuntime.createRequest;
const __configureRequest =
  typeof __requestRuntime.configure === 'function'
    ? __requestRuntime.configure
    : undefined;
const __createRequestContextHeaders =
  typeof __requestRuntime.createRequestContextHeaders === 'function'
    ? __requestRuntime.createRequestContextHeaders
    : undefined;

const __METHODS_WITHOUT_BODY = new Set(['GET', 'DELETE', 'HEAD', 'OPTIONS']);
const __DATA_REQUEST_MODES = new Set(['cache-first', 'stale-while-revalidate', 'network-only']);
const __DATA_MUTATION_MODES = new Set(['optimistic', 'pessimistic', 'fire-and-forget']);
const __DEFAULT_APP_NAMESPACE = ${JSON.stringify(dataPlatformAppNamespace)};
const __DEFAULT_ORIGIN = 'http://localhost:${String(options.port)}';
const __DEFAULT_BATCH_CONFIG = ${batchConfigCode};
const __REQUEST_ID = ${requestId ? JSON.stringify(requestId) : 'undefined'};
const __RUNTIME_FETCH =
  typeof fetch === 'function' ? fetch.bind(globalThis) : undefined;

if (__REQUEST_ID && __configureRequest) {
  const __configurePayload = {
    requestId: __REQUEST_ID,
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
    setDomain: () => {
      if (
        typeof window !== 'undefined' &&
        window.location &&
        typeof window.location.origin === 'string' &&
        window.location.origin
      ) {
        return window.location.origin;
      }

      if (
        typeof globalThis !== 'undefined' &&
        globalThis.location &&
        typeof globalThis.location.origin === 'string' &&
        globalThis.location.origin
      ) {
        return globalThis.location.origin;
      }

      return __DEFAULT_ORIGIN;
    },
  };

  if (__DEFAULT_BATCH_CONFIG.enabled !== false && __RUNTIME_FETCH) {
    __configurePayload.request = createDataBatchTransport({
      fetch: __RUNTIME_FETCH,
      endpoint: __DEFAULT_BATCH_CONFIG.endpoint,
      flushIntervalMs: __DEFAULT_BATCH_CONFIG.flushIntervalMs,
      maxBatchSize: __DEFAULT_BATCH_CONFIG.maxBatchSize,
      maxBatchBytes: __DEFAULT_BATCH_CONFIG.maxBatchBytes,
      requestTimeoutMs: __DEFAULT_BATCH_CONFIG.requestTimeoutMs,
      allowedMethods: __DEFAULT_BATCH_CONFIG.allowedMethods,
    });
  }

  __configureRequest(__configurePayload);
}

const __isRecord = value => typeof value === 'object' && value !== null;
const __stringOrUndefined = value =>
  typeof value === 'string' && value.length > 0 ? value : undefined;
const __isDataRequestMode = value =>
  typeof value === 'string' && __DATA_REQUEST_MODES.has(value);
const __isDataMutationMode = value =>
  typeof value === 'string' && __DATA_MUTATION_MODES.has(value);
const __normalizeOrigin = value => {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
};

const __normalizeRequest = (method, request = {}) => {
  if (!__isRecord(request)) {
    return {};
  }

  const payload = { ...request };

  if (__isRecord(request.path) && !__isRecord(payload.params)) {
    payload.params = request.path;
  }

  if (__isRecord(request.urlParams) && !__isRecord(payload.query)) {
    payload.query = request.urlParams;
  }

  if (__isRecord(request.headers) && !__isRecord(payload.headers)) {
    payload.headers = request.headers;
  }

  if ('payload' in request && request.payload !== undefined) {
    if (request.payload instanceof FormData && !('formData' in payload)) {
      payload.formData = request.payload;
    } else if (__METHODS_WITHOUT_BODY.has(method)) {
      if (__isRecord(request.payload)) {
        payload.query = __isRecord(payload.query)
          ? { ...payload.query, ...request.payload }
          : request.payload;
      } else if (!('body' in payload)) {
        payload.body = request.payload;
      }
    } else if (__isRecord(request.payload) && !('data' in payload)) {
      payload.data = request.payload;
    } else if (!('body' in payload)) {
      payload.body = request.payload;
    }
  }

  return payload;
};

const __resolveOrigin = () => {
  if (
    typeof window !== 'undefined' &&
    window.location &&
    typeof window.location.origin === 'string' &&
    window.location.origin
  ) {
    return window.location.origin;
  }

  if (
    typeof globalThis !== 'undefined' &&
    globalThis.location &&
    typeof globalThis.location.origin === 'string' &&
    globalThis.location.origin
  ) {
    return globalThis.location.origin;
  }

  return __DEFAULT_ORIGIN;
};

const __resolveTargetOrigin = dataPlatform => {
  const explicitTargetOrigin =
    __stringOrUndefined(dataPlatform.targetOrigin) ||
    __stringOrUndefined(dataPlatform.endpointOrigin);
  if (explicitTargetOrigin) {
    return explicitTargetOrigin;
  }
  return __DEFAULT_ORIGIN;
};

const __shouldAttachEnvelopeHeader = dataPlatform => {
  if (dataPlatform.allowCrossOriginEnvelope === true) {
    return true;
  }
  const currentOrigin = __normalizeOrigin(__resolveOrigin());
  const targetOrigin = __normalizeOrigin(__resolveTargetOrigin(dataPlatform));
  if (!currentOrigin || !targetOrigin) {
    return true;
  }
  return currentOrigin === targetOrigin;
};

const __toEnvelopeInput = normalizedRequest => {
  if (!__isRecord(normalizedRequest)) {
    return {};
  }

  const payload = {};
  if (__isRecord(normalizedRequest.params)) {
    payload.path = normalizedRequest.params;
  }
  if (__isRecord(normalizedRequest.query)) {
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

const createEffectRequestContext = requestContext => {
  if (!__isRecord(requestContext)) {
    return {};
  }

  const headers = __createRequestContextHeaders
    ? __createRequestContextHeaders(requestContext)
    : {};

  return {
    ...requestContext,
    headers,
  };
};

const __applyRequestContext = (normalizedRequest, request = {}) => {
  if (!__isRecord(request) || !__isRecord(request.requestContext)) {
    return normalizedRequest;
  }

  const requestContext = createEffectRequestContext(request.requestContext);
  const requestHeaders = __isRecord(requestContext.headers)
    ? requestContext.headers
    : {};

  if (Object.keys(requestHeaders).length === 0) {
    return normalizedRequest;
  }

  return {
    ...normalizedRequest,
    headers: {
      ...requestHeaders,
      ...(__isRecord(normalizedRequest.headers) ? normalizedRequest.headers : {}),
    },
  };
};

const __prepareEffectRequest = (method, routePath, operation, request = {}) => {
  const normalizedRequest = __applyRequestContext(
    __normalizeRequest(method, request),
    request,
  );
  const dataPlatform = __isRecord(request) && __isRecord(request.dataPlatform)
    ? request.dataPlatform
    : {};
  const strictEnvelope =
    dataPlatform.requireEnvelope === true || dataPlatform.strict === true;

  if (!strictEnvelope && !__shouldAttachEnvelopeHeader(dataPlatform)) {
    return normalizedRequest;
  }

  try {
    const namespace =
      __stringOrUndefined(dataPlatform.appNamespace) || __DEFAULT_APP_NAMESPACE;
    const origin = __stringOrUndefined(dataPlatform.origin) || __resolveOrigin();
    const envelope = createRequestEnvelope({
      operation: {
        ...operation,
        appNamespace: namespace,
      },
      scope: {
        appNamespace: namespace,
        origin,
        tenantId: __stringOrUndefined(dataPlatform.tenantId),
        userId: __stringOrUndefined(dataPlatform.userId),
        sessionId: __stringOrUndefined(dataPlatform.sessionId),
      },
      requestInput: {
        method,
        routePath,
        payload: __toEnvelopeInput(normalizedRequest),
      },
      requestMode: __isDataRequestMode(dataPlatform.requestMode)
        ? dataPlatform.requestMode
        : undefined,
      mutationMode: __isDataMutationMode(dataPlatform.mutationMode)
        ? dataPlatform.mutationMode
        : undefined,
      selectionPlan: __isRecord(dataPlatform.selectionPlan)
        ? dataPlatform.selectionPlan
        : undefined,
      traceContext: __isRecord(dataPlatform.traceContext)
        ? dataPlatform.traceContext
        : undefined,
      requireTraceContext: dataPlatform.requireTraceContext === true,
    });

    const headerName =
      __stringOrUndefined(dataPlatform.envelopeHeader) ||
      DEFAULT_DATA_ENVELOPE_HEADER;
    const headers = __isRecord(normalizedRequest.headers)
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

${senderDeclarations.join('\n')}
${operationDeclarations.join('\n')}
${callerDeclarations.join('\n')}

const client = ${clientObject};
const operationManifest = ${operationManifestObject};
const effectBffModule = {
  client,
  operationManifest,
  createEffectRequestContext,
};

export { client, createEffectRequestContext, operationManifest };
export default effectBffModule;
`;
}

export function renderEffectClientDeclaration() {
  return `export type EffectClientOperation = (
  request?: unknown,
) => Promise<unknown>;
export type EffectClientGroup = Record<string, EffectClientOperation>;
export type EffectClient = Record<string, EffectClientGroup>;
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
export type EffectOperationManifest = Record<
  string,
  Record<string, EffectOperationDescriptor>
>;
export type EffectOperationContext = {
  requestId?: string;
  operationId?: string;
  routePath?: string;
  method?: string;
  schemaHash?: string;
  operationVersion?: number;
  locale?: string;
  traceparent?: string;
  traceId?: string;
  spanId?: string;
  source?: string;
  scope?: Record<string, unknown>;
  sessionClaims?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
};
export type EffectRequestContext = {
  headers?: Record<string, string>;
  locale?: string;
  operationContext?: EffectOperationContext;
  traceparent?: string;
  traceId?: string;
  spanId?: string;
};

export declare const client: EffectClient;
export declare const createEffectRequestContext: (
  requestContext: Record<string, unknown>,
) => EffectRequestContext;
export declare const operationManifest: EffectOperationManifest;
declare const effectBffModule: {
  client: EffectClient;
  createEffectRequestContext: typeof createEffectRequestContext;
  operationManifest: EffectOperationManifest;
};

export default effectBffModule;
`;
}

export async function generateEffectClientCode(
  options: EffectClientCodegenOptions,
) {
  const api = await loadEffectApi(options.resourcePath);
  if (!api) {
    logger.warn(
      `[BFF][Effect] Failed to generate client for ${options.resourcePath}: unable to resolve exported HttpApi.`,
    );
    return null;
  }

  const httpApiRuntime = await getHttpApiRuntime();
  const endpoints = collectEffectEndpoints(httpApiRuntime, api, options.prefix);
  return renderEffectClientCode(endpoints, options);
}

export function resolveEffectEntryFile(options: {
  appDir: string;
  apiDir: string;
  effectEntry?: string;
}) {
  const { appDir, apiDir, effectEntry } = options;

  const defaultEntry = path.resolve(apiDir, 'effect', 'index');
  const entryWithoutExt = effectEntry
    ? path.isAbsolute(effectEntry)
      ? effectEntry
      : path.resolve(appDir, effectEntry)
    : defaultEntry;

  if (path.extname(entryWithoutExt)) {
    return fs.existsSync(entryWithoutExt) ? entryWithoutExt : undefined;
  }

  return findExists(JS_OR_TS_EXTS.map(ext => `${entryWithoutExt}${ext}`));
}
