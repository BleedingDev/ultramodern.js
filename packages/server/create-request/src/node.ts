import type { IncomingHttpHeaders } from 'http';
import { storage } from '@modern-js/runtime-utils/node';
import { compile } from 'path-to-regexp';
import { stringify } from 'qs';
import { handleRes } from './handleRes';
import { executeWithResilience } from './transport';
import type {
  AllowCrossOriginEnvelope,
  BFFRequestPayload,
  IOptions,
  IdentityBindingOptions,
  IdentityBindingViolation,
  OperationContext,
  RequestCreator,
  RequestCreatorOptions,
  ResolveHeaders,
  Sender,
  TransportResilienceOptions,
  UploadCreator,
} from './types';
import { getUploadPayload } from './utiles';

type Fetch = typeof fetch;

const realRequest: Map<string, Fetch> = new Map();

const realAllowedHeaders: Map<string, string[]> = new Map();
const realResolveHeaders: Map<string, ResolveHeaders> = new Map();
const realRequireEnvelope: Map<string, boolean> = new Map();
const realAllowCrossOriginEnvelope: Map<string, AllowCrossOriginEnvelope> =
  new Map();
const realTransportResilience: Map<string, TransportResilienceOptions> =
  new Map();
const realIdentityBinding: Map<string, IdentityBindingOptions> = new Map();
const domainMap: Map<string, string> = new Map();
const isEmptyDomain = (domain?: string) =>
  typeof domain !== 'string' || domain.trim() === '';
const ENVELOPE_HEADER = 'x-modernjs-bff-envelope';
const OPERATION_CONTEXT_HEADER = 'x-operation-id';
const OPERATION_CONTEXT_DETAIL_HEADER = 'x-modernjs-bff-operation-context';
const TRACEPARENT_HEADER = 'traceparent';
const TRACEPARENT_REGEX = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/i;
const DEFAULT_PROTECTED_IDENTITY_HEADERS = [
  'x-tenant-id',
  'x-subject-id',
  'x-user-id',
  'x-operation-id',
];

const firstHeaderValue = (value?: string | string[]) =>
  Array.isArray(value) ? value[0] : value;

const findHeaderKey = (headers: Record<string, any>, header: string) => {
  const normalized = header.toLowerCase();
  return Object.keys(headers).find(key => key.toLowerCase() === normalized);
};

const readHeader = (headers: Record<string, any>, header: string) => {
  const key = findHeaderKey(headers, header);
  return typeof key === 'string' ? headers[key] : undefined;
};

const writeHeader = (
  headers: Record<string, any>,
  header: string,
  value: unknown,
) => {
  if (typeof value === 'undefined') {
    return;
  }
  const key = findHeaderKey(headers, header);
  if (typeof key === 'string' && key !== header) {
    delete headers[key];
  }
  headers[header] = value;
};

const deleteHeader = (headers: Record<string, any>, header: string) => {
  const key = findHeaderKey(headers, header);
  if (typeof key === 'string') {
    delete headers[key];
  }
};

const toOrigin = (value?: string) => {
  if (!value) {
    return undefined;
  }
  try {
    return new URL(value).origin;
  } catch (error) {
    return undefined;
  }
};

const parseTraceparent = (value: unknown) => {
  const traceparent = firstHeaderValue(value as string | string[]);
  if (typeof traceparent !== 'string') {
    return undefined;
  }

  const match = traceparent.trim().match(TRACEPARENT_REGEX);
  if (!match) {
    return undefined;
  }

  return {
    traceId: match[1].toLowerCase(),
    spanId: match[2].toLowerCase(),
  };
};

const resolveSourceOrigin = (headers: Record<string, any>) => {
  const origin = toOrigin(firstHeaderValue(headers.origin));
  if (origin) {
    return origin;
  }

  const referer = toOrigin(firstHeaderValue(headers.referer));
  if (referer) {
    return referer;
  }

  const host = firstHeaderValue(headers.host);
  if (!host) {
    return undefined;
  }
  const proto = firstHeaderValue(headers['x-forwarded-proto']) || 'http';
  return `${proto}://${host}`;
};

const extractPathParamNames = (path: string): string[] =>
  Array.from(path.matchAll(/:([A-Za-z0-9_]+)/g)).map(([, key]) => key);

const originFetch = (...params: Parameters<Fetch>) => {
  const [, init] = params;

  if (init?.method?.toLowerCase() === 'get') {
    init.body = undefined;
  }

  return fetch(...params).then(handleRes);
};

const buildOperationContext = ({
  requestId,
  method,
  path,
  operationContext,
  traceparent,
}: {
  requestId: string;
  method: string;
  path: string;
  operationContext?: OperationContext | undefined;
  traceparent?: unknown;
}) => {
  const routePath = operationContext?.routePath || path;
  const operationMethod = (
    operationContext?.method ||
    method ||
    'GET'
  ).toUpperCase();
  const rawOperationId =
    operationContext?.operationId || `${operationMethod}:${routePath}`;
  const operationId = rawOperationId.startsWith(`${requestId}:`)
    ? rawOperationId
    : `${requestId}:${rawOperationId}`;
  const traceparentValue =
    operationContext?.traceparent ||
    (typeof firstHeaderValue(traceparent as string | string[]) === 'string'
      ? String(firstHeaderValue(traceparent as string | string[]))
      : undefined);
  const parsedTraceContext =
    operationContext?.traceId && operationContext?.spanId
      ? {
          traceId: operationContext.traceId,
          spanId: operationContext.spanId,
        }
      : parseTraceparent(traceparentValue);

  return {
    requestId,
    operationId,
    routePath,
    method: operationMethod,
    ...(operationContext?.schemaHash
      ? { schemaHash: operationContext.schemaHash }
      : {}),
    ...(typeof operationContext?.operationVersion === 'number'
      ? { operationVersion: operationContext.operationVersion }
      : {}),
    ...(traceparentValue ? { traceparent: traceparentValue } : {}),
    ...(parsedTraceContext
      ? {
          traceId: parsedTraceContext.traceId,
          spanId: parsedTraceContext.spanId,
        }
      : {}),
  };
};

export class ProducerClientNotInitializedError extends Error {
  readonly code = 'BFF_PRODUCER_CLIENT_NOT_INITIALIZED';

  constructor(requestId: string) {
    super(
      `Producer client "${requestId}" is not initialized. Call initProducerClient() (or configure()) before using generated APIs for this requestId.`,
    );
    this.name = 'ProducerClientNotInitializedError';
  }
}

export class ProducerDomainNotConfiguredError extends Error {
  readonly code = 'BFF_PRODUCER_DOMAIN_NOT_CONFIGURED';

  constructor(requestId: string) {
    super(
      `Producer client "${requestId}" must provide setDomain() during configure().`,
    );
    this.name = 'ProducerDomainNotConfiguredError';
  }
}

export class CrossOriginEnvelopePolicyError extends Error {
  readonly code = 'BFF_CROSS_ORIGIN_ENVELOPE_NOT_ALLOWED';

  constructor(requestId: string, sourceOrigin?: string, targetOrigin?: string) {
    super(
      `Cross-origin envelope is not allowed for producer "${requestId}" (${sourceOrigin || 'unknown-origin'} -> ${targetOrigin || 'unknown-origin'}). Configure allowCrossOriginEnvelope to explicitly allow this flow.`,
    );
    this.name = 'CrossOriginEnvelopePolicyError';
  }
}

export class IdentityBindingViolationError extends Error {
  readonly code = 'BFF_IDENTITY_BINDING_VIOLATION';

  readonly violation: IdentityBindingViolation;

  constructor(violation: IdentityBindingViolation) {
    super(
      `Identity header "${violation.header}" for producer "${violation.requestId}" was rejected by server-derived identity binding.`,
    );
    this.name = 'IdentityBindingViolationError';
    this.violation = violation;
  }
}

const getConfiguredRequest = (requestId: string, fallback: Fetch) => {
  const configuredRequest = realRequest.get(requestId);
  if (configuredRequest) {
    return configuredRequest;
  }

  if (requestId !== 'default') {
    throw new ProducerClientNotInitializedError(requestId);
  }

  return fallback;
};

export const configure = (options: IOptions<Fetch>) => {
  const {
    request,
    interceptor,
    allowedHeaders,
    resolveHeaders,
    transport,
    requireEnvelope,
    allowCrossOriginEnvelope,
    identityBinding,
    setDomain,
    requestId = 'default',
  } = options;

  const hasExistingDomain = domainMap.has(requestId);
  if (requestId !== 'default' && !setDomain && !hasExistingDomain) {
    throw new ProducerDomainNotConfiguredError(requestId);
  }

  let configuredRequest = (request as Fetch) || originFetch;
  if (interceptor && !request) {
    configuredRequest = interceptor(fetch);
  }
  if (Array.isArray(allowedHeaders)) {
    realAllowedHeaders.set(requestId, allowedHeaders);
  }
  if (typeof resolveHeaders === 'function') {
    realResolveHeaders.set(requestId, resolveHeaders);
  }
  if (transport && typeof transport === 'object') {
    realTransportResilience.set(requestId, transport);
  }
  if (identityBinding && typeof identityBinding === 'object') {
    realIdentityBinding.set(requestId, identityBinding);
  }
  if (typeof requireEnvelope === 'boolean') {
    realRequireEnvelope.set(requestId, requireEnvelope);
  }
  if (
    typeof allowCrossOriginEnvelope === 'boolean' ||
    typeof allowCrossOriginEnvelope === 'function'
  ) {
    realAllowCrossOriginEnvelope.set(requestId, allowCrossOriginEnvelope);
  }
  if (setDomain) {
    const resolvedDomain = setDomain({
      target: 'server',
      requestId,
    });
    if (requestId !== 'default' && isEmptyDomain(resolvedDomain)) {
      throw new ProducerDomainNotConfiguredError(requestId);
    }
    if (typeof resolvedDomain === 'string') {
      domainMap.set(requestId, resolvedDomain);
    }
  }
  realRequest.set(requestId, configuredRequest);
};

const normalizeRequestOptions = (
  ...args: Parameters<RequestCreator<Fetch>>
): RequestCreatorOptions<Fetch> => {
  if (typeof args[0] === 'object' && args[0] !== null) {
    return args[0];
  }

  const [
    path,
    method,
    port,
    httpMethodDecider,
    fetch,
    requestId,
    operationContext,
  ] = args;

  return {
    path,
    method,
    port,
    httpMethodDecider,
    fetch,
    requestId,
    operationContext,
  };
};

export const createRequest: RequestCreator<Fetch> = ((
  ...args: Parameters<RequestCreator<Fetch>>
) => {
  const {
    path,
    method,
    port,
    httpMethodDecider = 'functionName', // 后续可能要修改，暂时先保留
    fetch = originFetch,
    requestId = 'default',
    operationContext,
  } = normalizeRequestOptions(...args);
  const getFinalPath = compile(path, { encode: encodeURIComponent });
  const keyNames = extractPathParamNames(path);

  const sender: Sender = (...args) => {
    const fetcher = getConfiguredRequest(requestId, fetch);

    let webRequestHeaders = {} as Record<string, any>;
    try {
      webRequestHeaders = storage.useContext().headers || {};
    } catch (error) {
      webRequestHeaders = {};
    }

    let body;
    let headers: Record<string, any>;
    let url: string;

    if (httpMethodDecider === 'inputParams') {
      const configDomain = domainMap.get(requestId);
      if (requestId !== 'default' && isEmptyDomain(configDomain)) {
        throw new ProducerDomainNotConfiguredError(requestId);
      }
      url = `${configDomain || `http://127.0.0.1:${port}`}${path}`;
      body = args as any;
      headers = {
        'Content-Type': 'application/json',
      };
    } else {
      const payload: BFFRequestPayload =
        typeof args[args.length - 1] === 'object' ? args[args.length - 1] : {};
      payload.params = payload.params || {};

      const requestParams = args[0];
      // 这种场景下是使用 schema，所以 params 要从 args[0] 中获取
      if (typeof requestParams === 'object' && requestParams.params) {
        const { params } = requestParams;
        keyNames.forEach(keyName => {
          payload.params![keyName] = params[keyName];
        });
      } else {
        keyNames.forEach((keyName, index) => {
          payload.params![keyName] = args[index];
        });
      }

      const plainPath = getFinalPath(payload.params);
      const finalPath = payload.query
        ? `${plainPath}?${stringify(payload.query)}`
        : plainPath;
      headers = payload.headers ? { ...payload.headers } : {};
      const identityBinding = realIdentityBinding.get(requestId);
      const identityBindingEnabled =
        identityBinding?.enabled ?? requestId !== 'default';
      const protectedIdentityHeaders = (
        identityBinding?.protectedHeaders || DEFAULT_PROTECTED_IDENTITY_HEADERS
      ).map(header => header.toLowerCase());

      const targetAllowedHeaders = realAllowedHeaders.get(requestId) || [];
      const forwardedHeaders: Record<string, any> = {};
      for (const key of targetAllowedHeaders) {
        if (typeof webRequestHeaders[key] !== 'undefined') {
          forwardedHeaders[key] = webRequestHeaders[key];
        }
      }

      if (identityBindingEnabled) {
        const derivedIdentityHeaders: Record<string, any> = {};
        for (const header of protectedIdentityHeaders) {
          const incomingHeaderValue = readHeader(webRequestHeaders, header);
          if (typeof incomingHeaderValue !== 'undefined') {
            writeHeader(derivedIdentityHeaders, header, incomingHeaderValue);
          }
        }

        const customDerivedHeaders = identityBinding?.deriveHeaders?.({
          requestId,
          target: 'server',
          incomingHeaders: { ...webRequestHeaders },
          protectedHeaders: [...protectedIdentityHeaders],
        });
        if (customDerivedHeaders && typeof customDerivedHeaders === 'object') {
          for (const header of protectedIdentityHeaders) {
            const customValue = readHeader(customDerivedHeaders, header);
            if (typeof customValue !== 'undefined') {
              writeHeader(derivedIdentityHeaders, header, customValue);
            }
          }
        }

        for (const header of protectedIdentityHeaders) {
          const attemptedValue = readHeader(headers, header);
          if (typeof attemptedValue === 'undefined') {
            continue;
          }

          const violation: IdentityBindingViolation = {
            requestId,
            target: 'server',
            header,
            attemptedValue,
            derivedValue: readHeader(derivedIdentityHeaders, header),
            reason: identityBinding?.strict
              ? 'client_override_rejected'
              : 'client_override_blocked',
          };
          identityBinding?.onViolation?.(violation);

          if (identityBinding?.strict) {
            throw new IdentityBindingViolationError(violation);
          }

          deleteHeader(headers, header);
        }

        Object.keys(derivedIdentityHeaders).forEach(header => {
          writeHeader(forwardedHeaders, header, derivedIdentityHeaders[header]);
        });
      }

      const resolveHeaders = realResolveHeaders.get(requestId);
      if (resolveHeaders) {
        const resolvedHeaders = resolveHeaders({
          requestId,
          allowedHeaders: targetAllowedHeaders,
          incomingHeaders: { ...forwardedHeaders },
        });
        if (resolvedHeaders && typeof resolvedHeaders === 'object') {
          for (const key of targetAllowedHeaders) {
            if (typeof resolvedHeaders[key] !== 'undefined') {
              forwardedHeaders[key] = resolvedHeaders[key];
            }
          }
        }
      }
      headers = { ...headers, ...forwardedHeaders };

      if (payload.data) {
        headers['Content-Type'] = 'application/json';
        body =
          typeof payload.data === 'object'
            ? JSON.stringify(payload.data)
            : payload.body;
      } else if (payload.body) {
        headers['Content-Type'] = 'text/plain';
        body = payload.body;
      } else if (payload.formData) {
        body = payload.formData;
        // https://stackoverflow.com/questions/44919424/bad-content-type-header-no-multipart-boundary-nodejs
        // need multipart boundary auto attached by node-fetch when multipart is true
        // headers['Content-Type'] = 'multipart/form-data';
      } else if (payload.formUrlencoded) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        if (typeof payload.formUrlencoded === 'object') {
          body = stringify(payload.formUrlencoded);
        } else {
          body = payload.formUrlencoded;
        }
      }
      const configDomain = domainMap.get(requestId);
      if (requestId !== 'default' && isEmptyDomain(configDomain)) {
        throw new ProducerDomainNotConfiguredError(requestId);
      }
      url = `${configDomain || `http://127.0.0.1:${port}`}${finalPath}`;
    }

    if (typeof readHeader(headers, TRACEPARENT_HEADER) === 'undefined') {
      const incomingTraceparent = firstHeaderValue(
        readHeader(webRequestHeaders, TRACEPARENT_HEADER) as string | string[],
      );
      if (typeof incomingTraceparent === 'string') {
        writeHeader(headers, TRACEPARENT_HEADER, incomingTraceparent);
      }
    }
    if (
      typeof readHeader(headers, TRACEPARENT_HEADER) === 'undefined' &&
      operationContext?.traceparent
    ) {
      writeHeader(headers, TRACEPARENT_HEADER, operationContext.traceparent);
    }

    const shouldRequireEnvelope =
      realRequireEnvelope.get(requestId) ??
      (requestId !== 'default' && process.env.NODE_ENV === 'production');
    if (shouldRequireEnvelope) {
      const sourceOrigin = resolveSourceOrigin(webRequestHeaders);
      const targetOrigin = toOrigin(url);
      const traceContext = parseTraceparent(
        readHeader(headers, TRACEPARENT_HEADER),
      );
      const isCrossOrigin =
        Boolean(sourceOrigin) &&
        Boolean(targetOrigin) &&
        sourceOrigin !== targetOrigin;

      if (isCrossOrigin) {
        const policy = realAllowCrossOriginEnvelope.get(requestId);
        const isAllowed =
          typeof policy === 'function'
            ? policy({
                requestId,
                sourceOrigin,
                targetOrigin,
                target: 'server',
              })
            : policy === true;
        if (!isAllowed) {
          throw new CrossOriginEnvelopePolicyError(
            requestId,
            sourceOrigin,
            targetOrigin,
          );
        }
      }

      headers[ENVELOPE_HEADER] = JSON.stringify({
        requestId,
        target: 'server',
        timestamp: Date.now(),
        sourceOrigin,
        targetOrigin,
        ...(traceContext
          ? {
              traceId: traceContext.traceId,
              spanId: traceContext.spanId,
            }
          : {}),
      });
    }

    if (requestId !== 'default') {
      const contextPayload = buildOperationContext({
        requestId,
        method,
        path,
        operationContext,
        traceparent: readHeader(headers, TRACEPARENT_HEADER),
      });

      if (
        typeof readHeader(headers, OPERATION_CONTEXT_HEADER) === 'undefined'
      ) {
        writeHeader(
          headers,
          OPERATION_CONTEXT_HEADER,
          contextPayload.operationId,
        );
      }
      writeHeader(
        headers,
        OPERATION_CONTEXT_DETAIL_HEADER,
        JSON.stringify(contextPayload),
      );
    }

    if (method.toLowerCase() === 'get') {
      body = undefined;
    }

    headers.accept = `application/json,*/*;q=0.8`;

    return executeWithResilience({
      requestId,
      target: 'server',
      method,
      url,
      init: {
        method,
        body,
        headers,
      },
      fetcher,
      transport: realTransportResilience.get(requestId),
    });
  };

  return sender;
}) as RequestCreator<Fetch>;

export const createUploader: UploadCreator = ({
  path,
  requestId = 'default',
}) => {
  const sender: Sender = (...args) => {
    const fetcher = getConfiguredRequest(requestId, originFetch);
    const { body, headers } = getUploadPayload(args);

    const configDomain = domainMap.get(requestId);
    const finalURL = `${configDomain || ''}${path}`;

    return fetcher(finalURL, { method: 'POST', body, headers });
  };

  return sender;
};
