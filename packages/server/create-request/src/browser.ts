import { compile } from 'path-to-regexp';
import { stringify } from 'qs';
import { handleRes } from './handleRes';
import { executeWithResilience } from './transport';
import type {
  AllowCrossOriginEnvelope,
  BFFRequestPayload,
  IdentityBindingOptions,
  IdentityBindingViolation,
  IOptions,
  OperationContext,
  OperationContractOptions,
  OperationContractViolation,
  RequestCreator,
  RequestCreatorOptions,
  Sender,
  TransportResilienceOptions,
  UploadCreator,
} from './types';
import {
  BFF_DEFAULT_PROTECTED_IDENTITY_HEADERS,
  BFF_OPERATION_CONTEXT_DETAIL_HEADER,
  BFF_ENVELOPE_HEADER as ENVELOPE_HEADER,
  BFF_OPERATION_CONTEXT_HEADER as OPERATION_CONTEXT_HEADER,
} from './types';
import { getUploadPayload } from './utiles';

const realRequest: Map<string, typeof fetch> = new Map();

const realAllowedHeaders: Map<string, string[]> = new Map();
const realRequireEnvelope: Map<string, boolean> = new Map();
const realAllowCrossOriginEnvelope: Map<string, AllowCrossOriginEnvelope> =
  new Map();
const realTransportResilience: Map<string, TransportResilienceOptions> =
  new Map();
const realIdentityBinding: Map<string, IdentityBindingOptions> = new Map();
const realOperationContract: Map<string, OperationContractOptions> = new Map();
const domainMap: Map<string, string> = new Map();
const isEmptyDomain = (domain?: string) =>
  typeof domain !== 'string' || domain.trim() === '';
const TRACEPARENT_HEADER = 'traceparent';
const OPERATION_CONTEXT_DETAIL_HEADER =
  BFF_OPERATION_CONTEXT_DETAIL_HEADER satisfies 'x-modernjs-bff-operation-context';
const TRACEPARENT_REGEX = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/i;
const readProcessEnv = (key: string) => {
  if (
    typeof process === 'undefined' ||
    typeof process.env === 'undefined' ||
    typeof process.env[key] !== 'string'
  ) {
    return undefined;
  }

  return process.env[key];
};
const isStrictDefaultRequestIdEnabled = () =>
  readProcessEnv('MODERN_BFF_STRICT_DEFAULT_REQUEST_ID') === 'true';
const isSecuredRequestId = (requestId: string) =>
  requestId !== 'default' || isStrictDefaultRequestIdEnabled();

const firstHeaderValue = (value: unknown) =>
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
  const traceparent = firstHeaderValue(value);
  if (typeof traceparent !== 'string') {
    return undefined;
  }

  const match = traceparent.trim().match(TRACEPARENT_REGEX);
  if (!match) {
    return undefined;
  }

  const [, traceId, spanId] = match;
  if (!traceId || !spanId) {
    return undefined;
  }

  return {
    traceId: traceId.toLowerCase(),
    spanId: spanId.toLowerCase(),
  };
};

const extractPathParamNames = (path: string): string[] =>
  Array.from(path.matchAll(/:([A-Za-z0-9_]+)/g)).flatMap(([, key]) =>
    key ? [key] : [],
  );

const originFetch = (...params: Parameters<typeof fetch>) => {
  const [url, init] = params;

  if (init?.method?.toLowerCase() === 'get') {
    init.body = undefined;
  }
  return fetch(url, init).then(handleRes);
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
    (typeof firstHeaderValue(traceparent) === 'string'
      ? String(firstHeaderValue(traceparent))
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

export class OperationContractViolationError extends Error {
  readonly code = 'BFF_OPERATION_CONTRACT_VIOLATION';

  readonly violation: OperationContractViolation;

  constructor(violation: OperationContractViolation) {
    super(
      `Operation contract violation "${violation.reason}" for producer "${violation.requestId}" operation "${violation.operationId}".`,
    );
    this.name = 'OperationContractViolationError';
    this.violation = violation;
  }
}

const validateOperationContract = (
  requestId: string,
  contextPayload: ReturnType<typeof buildOperationContext>,
) => {
  const operationContract = realOperationContract.get(requestId);
  const operationContractEnabled =
    operationContract?.enabled ?? isSecuredRequestId(requestId);

  if (!operationContractEnabled) {
    return;
  }

  const strict = operationContract?.strict ?? true;
  const requireSchemaHash = operationContract?.requireSchemaHash ?? true;
  const requireOperationVersion =
    operationContract?.requireOperationVersion ?? true;

  const maybeReportViolation = (
    reason: OperationContractViolation['reason'],
  ) => {
    const violation: OperationContractViolation = {
      requestId,
      target: 'browser',
      operationId: contextPayload.operationId,
      routePath: contextPayload.routePath,
      method: contextPayload.method,
      schemaHash:
        typeof contextPayload.schemaHash === 'string'
          ? contextPayload.schemaHash
          : undefined,
      operationVersion:
        typeof contextPayload.operationVersion === 'number'
          ? contextPayload.operationVersion
          : undefined,
      reason,
    };
    operationContract?.onViolation?.(violation);
    if (strict) {
      throw new OperationContractViolationError(violation);
    }
  };

  if (requireSchemaHash && typeof contextPayload.schemaHash !== 'string') {
    maybeReportViolation('missing_schema_hash');
  }

  if (
    requireOperationVersion &&
    typeof contextPayload.operationVersion !== 'number'
  ) {
    maybeReportViolation('missing_operation_version');
  }
};

const getConfiguredRequest = (requestId: string, fallback: typeof fetch) => {
  const configuredRequest = realRequest.get(requestId);
  if (configuredRequest) {
    return configuredRequest;
  }

  if (requestId !== 'default') {
    throw new ProducerClientNotInitializedError(requestId);
  }

  return fallback;
};

export const configure = (options: IOptions) => {
  const {
    request,
    interceptor,
    allowedHeaders,
    transport,
    requireEnvelope,
    allowCrossOriginEnvelope,
    identityBinding,
    operationContract,
    setDomain,
    requestId = 'default',
  } = options;

  const hasExistingDomain = domainMap.has(requestId);
  if (requestId !== 'default' && !setDomain && !hasExistingDomain) {
    throw new ProducerDomainNotConfiguredError(requestId);
  }

  let configuredRequest = request || originFetch;
  if (interceptor && !request) {
    configuredRequest = interceptor(fetch);
  }
  if (Array.isArray(allowedHeaders)) {
    realAllowedHeaders.set(requestId, allowedHeaders);
  }
  if (transport && typeof transport === 'object') {
    realTransportResilience.set(requestId, transport);
  }
  if (identityBinding && typeof identityBinding === 'object') {
    realIdentityBinding.set(requestId, identityBinding);
  }
  if (operationContract && typeof operationContract === 'object') {
    realOperationContract.set(requestId, operationContract);
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
      target: 'browser',
      requestId,
    });
    if (requestId !== 'default' && isEmptyDomain(resolvedDomain)) {
      throw new ProducerDomainNotConfiguredError(requestId);
    }
    if (typeof resolvedDomain === 'string') {
      domainMap.set(requestId, resolvedDomain);
    }
  }
  realRequest.set(requestId, configuredRequest as any);
};

const normalizeRequestOptions = (
  ...args: Parameters<RequestCreator>
): RequestCreatorOptions => {
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

export const createRequest: RequestCreator = ((
  ...args: Parameters<RequestCreator>
) => {
  const {
    path,
    method,
    port,
    httpMethodDecider = 'functionName', // 后续可能要修改，暂时先保留
    fetch = originFetch,
    domain,
    requestId = 'default',
    operationContext,
  } = normalizeRequestOptions(...args);
  const getFinalPath = compile(path, { encode: encodeURIComponent });
  const keyNames = extractPathParamNames(path);

  const sender: Sender = async (...args) => {
    const fetcher = getConfiguredRequest(requestId, fetch);

    let body;
    let finalURL: string;
    let headers: Record<string, any>;

    if (httpMethodDecider === 'inputParams') {
      finalURL = path;
      body = JSON.stringify({
        args,
      });
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

      const finalPath = getFinalPath(payload.params);

      finalURL = payload.query
        ? `${finalPath}?${stringify(payload.query)}`
        : finalPath;
      headers = payload.headers ? { ...payload.headers } : {};
      const identityBinding = realIdentityBinding.get(requestId);
      const identityBindingEnabled =
        identityBinding?.enabled ?? isSecuredRequestId(requestId);
      const identityBindingStrict =
        identityBinding?.strict ?? isSecuredRequestId(requestId);
      const protectedIdentityHeaders = (
        identityBinding?.protectedHeaders ||
        BFF_DEFAULT_PROTECTED_IDENTITY_HEADERS
      ).map(header => header.toLowerCase());

      if (identityBindingEnabled) {
        const derivedIdentityHeaders: Record<string, any> = {};
        const customDerivedHeaders = identityBinding?.deriveHeaders?.({
          requestId,
          target: 'browser',
          incomingHeaders: {},
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
            target: 'browser',
            header,
            attemptedValue,
            derivedValue: readHeader(derivedIdentityHeaders, header),
            reason: identityBindingStrict
              ? 'client_override_rejected'
              : 'client_override_blocked',
          };
          identityBinding?.onViolation?.(violation);

          if (identityBindingStrict) {
            throw new IdentityBindingViolationError(violation);
          }

          deleteHeader(headers, header);
        }

        Object.keys(derivedIdentityHeaders).forEach(header => {
          writeHeader(headers, header, derivedIdentityHeaders[header]);
        });
      }

      body =
        payload.data && typeof payload.data === 'object'
          ? JSON.stringify(payload.data)
          : payload.body;

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
        // need multipart boundary aotu attached by browser when multipart is true
        // headers['Content-Type'] = 'multipart/form-data';
      } else if (payload.formUrlencoded) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        if (
          typeof payload.formUrlencoded === 'object' &&
          // eslint-disable-next-line node/prefer-global/url-search-params,node/no-unsupported-features/node-builtins
          !(payload.formUrlencoded instanceof URLSearchParams)
        ) {
          body = stringify(payload.formUrlencoded);
        } else {
          body = payload.formUrlencoded;
        }
      }
    }

    headers.accept = `application/json,*/*;q=0.8`;

    const configDomain = domainMap.get(requestId);
    if (requestId !== 'default' && isEmptyDomain(configDomain)) {
      throw new ProducerDomainNotConfiguredError(requestId);
    }
    finalURL = `${configDomain || ''}${finalURL}`;

    const shouldRequireEnvelope =
      realRequireEnvelope.get(requestId) ?? isSecuredRequestId(requestId);
    if (shouldRequireEnvelope) {
      const sourceOrigin =
        typeof window !== 'undefined' ? window.location.origin : undefined;
      const targetOrigin = toOrigin(finalURL);
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
                target: 'browser',
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
        target: 'browser',
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

    if (isSecuredRequestId(requestId)) {
      if (
        typeof readHeader(headers, TRACEPARENT_HEADER) === 'undefined' &&
        operationContext?.traceparent
      ) {
        writeHeader(headers, TRACEPARENT_HEADER, operationContext.traceparent);
      }
      const contextPayload = buildOperationContext({
        requestId,
        method,
        path,
        operationContext,
        traceparent: readHeader(headers, TRACEPARENT_HEADER),
      });
      validateOperationContract(requestId, contextPayload);

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

    return executeWithResilience({
      requestId,
      target: 'browser',
      method,
      url: finalURL,
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
}) as RequestCreator;

export const createUploader: UploadCreator = ({
  path,
  domain,
  requestId = 'default',
}) => {
  const getFinalPath = compile(path, { encode: encodeURIComponent });
  const sender: Sender = (...args) => {
    const fetcher = getConfiguredRequest(requestId, originFetch);

    const { body, headers, params } = getUploadPayload(args);
    const finalPath = getFinalPath(params);

    const configDomain = domainMap.get(requestId);
    const finalURL = `${configDomain || domain || ''}${finalPath}`;

    return fetcher(finalURL, {
      method: 'POST',
      body,
      headers,
    });
  };

  return sender;
};

export * from './requestContext';
export * from './types';
