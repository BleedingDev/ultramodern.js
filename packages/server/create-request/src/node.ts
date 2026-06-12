import { storage } from '@modern-js/runtime-utils/node';
import { compile } from 'path-to-regexp';
import { stringify } from 'qs';
import { handleRes } from './handleRes';
import {
  attachOperationContextHeaders,
  buildEnvelopeHeaderValue,
  deleteHeader,
  extractPathParamNames,
  firstHeaderValue,
  IdentityBindingViolationError,
  isEmptyDomain,
  isSecuredRequestId,
  ProducerDomainNotConfiguredError,
  parseTraceparentValue,
  readHeader,
  resolveConfiguredRequest,
  TRACEPARENT_HEADER,
  toOrigin,
  writeHeader,
} from './policyCore';
import { executeWithResilience } from './transport';
import type {
  AllowCrossOriginEnvelope,
  BFFRequestPayload,
  IdentityBindingOptions,
  IdentityBindingViolation,
  IOptions,
  OperationContractOptions,
  RequestCreator,
  RequestCreatorOptions,
  ResolveHeaders,
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

export {
  CrossOriginEnvelopePolicyError,
  IdentityBindingViolationError,
  OperationContractViolationError,
  ProducerClientNotInitializedError,
  ProducerDomainNotConfiguredError,
} from './policyCore';

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
const realOperationContract: Map<string, OperationContractOptions> = new Map();
const domainMap: Map<string, string> = new Map();

const OPERATION_CONTEXT_DETAIL_HEADER =
  BFF_OPERATION_CONTEXT_DETAIL_HEADER satisfies 'x-modernjs-bff-operation-context';

const resolveSourceOrigin = (headers: Record<string, any>) => {
  const origin = toOrigin(firstHeaderValue(headers.origin) as string);
  if (origin) {
    return origin;
  }

  const referer = toOrigin(firstHeaderValue(headers.referer) as string);
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

const readIncomingWebHeaders = (): Record<string, any> => {
  try {
    return storage.useContext().headers || {};
  } catch (error) {
    return {};
  }
};

const originFetch = (...params: Parameters<Fetch>) => {
  const [, init] = params;

  if (init?.method?.toLowerCase() === 'get') {
    init.body = undefined;
  }

  return fetch(...params).then(handleRes);
};

const attachEnvelopeHeaderIfRequired = (
  headers: Record<string, any>,
  requestId: string,
  url: string,
  webRequestHeaders: Record<string, any>,
) => {
  const shouldRequireEnvelope =
    realRequireEnvelope.get(requestId) ?? isSecuredRequestId(requestId);
  if (!shouldRequireEnvelope) {
    return;
  }

  headers[ENVELOPE_HEADER] = buildEnvelopeHeaderValue({
    requestId,
    target: 'server',
    sourceOrigin: resolveSourceOrigin(webRequestHeaders),
    targetOrigin: toOrigin(url),
    traceContext: parseTraceparentValue(
      readHeader(headers, TRACEPARENT_HEADER),
    ),
    allowCrossOriginEnvelope: realAllowCrossOriginEnvelope.get(requestId),
  });
};

const attachSecuredOperationHeaders = (
  headers: Record<string, any>,
  requestId: string,
  method: string,
  path: string,
  operationContext: RequestCreatorOptions<Fetch>['operationContext'],
) => {
  if (!isSecuredRequestId(requestId)) {
    return;
  }
  attachOperationContextHeaders({
    headers,
    requestId,
    target: 'server',
    method,
    path,
    operationContext,
    operationContract: realOperationContract.get(requestId),
    operationContextHeader: OPERATION_CONTEXT_HEADER,
    operationContextDetailHeader: OPERATION_CONTEXT_DETAIL_HEADER,
  });
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
    operationContract,
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
    const fetcher = resolveConfiguredRequest(realRequest, requestId, fetch);

    const webRequestHeaders = readIncomingWebHeaders();

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
        identityBinding?.enabled ?? isSecuredRequestId(requestId);
      const identityBindingStrict =
        identityBinding?.strict ?? isSecuredRequestId(requestId);
      const protectedIdentityHeaders = (
        identityBinding?.protectedHeaders ||
        BFF_DEFAULT_PROTECTED_IDENTITY_HEADERS
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
        readHeader(webRequestHeaders, TRACEPARENT_HEADER),
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

    attachEnvelopeHeaderIfRequired(headers, requestId, url, webRequestHeaders);
    attachSecuredOperationHeaders(
      headers,
      requestId,
      method,
      path,
      operationContext,
    );

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
  operationContext,
}) => {
  const sender: Sender = (...args) => {
    const fetcher = resolveConfiguredRequest(
      realRequest,
      requestId,
      originFetch,
    );
    const { body, headers: uploadHeaders } = getUploadPayload(args);
    const headers: Record<string, any> = { ...uploadHeaders };

    const configDomain = domainMap.get(requestId);
    const finalURL = `${configDomain || ''}${path}`;

    attachEnvelopeHeaderIfRequired(
      headers,
      requestId,
      finalURL,
      readIncomingWebHeaders(),
    );
    attachSecuredOperationHeaders(
      headers,
      requestId,
      'POST',
      path,
      operationContext,
    );

    return fetcher(finalURL, { method: 'POST', body, headers });
  };

  return sender;
};

export * from './requestContext';
export * from './traceparent';
export * from './types';
