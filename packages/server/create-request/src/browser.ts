import { compile } from 'path-to-regexp';
import { stringify } from 'qs';
import { handleRes } from './handleRes';
import {
  attachOperationContextHeaders,
  buildEnvelopeHeaderValue,
  deleteHeader,
  extractPathParamNames,
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

const OPERATION_CONTEXT_DETAIL_HEADER =
  BFF_OPERATION_CONTEXT_DETAIL_HEADER satisfies 'x-modernjs-bff-operation-context';

const resolveBrowserOrigin = () =>
  typeof window !== 'undefined' ? window.location.origin : undefined;

const originFetch = (...params: Parameters<typeof fetch>) => {
  const [url, init] = params;

  if (init?.method?.toLowerCase() === 'get') {
    init.body = undefined;
  }
  return fetch(url, init).then(handleRes);
};

const attachEnvelopeHeaderIfRequired = (
  headers: Record<string, any>,
  requestId: string,
  finalURL: string,
) => {
  const shouldRequireEnvelope =
    realRequireEnvelope.get(requestId) ?? isSecuredRequestId(requestId);
  if (!shouldRequireEnvelope) {
    return;
  }

  headers[ENVELOPE_HEADER] = buildEnvelopeHeaderValue({
    requestId,
    target: 'browser',
    sourceOrigin: resolveBrowserOrigin(),
    targetOrigin: toOrigin(finalURL),
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
  operationContext: RequestCreatorOptions['operationContext'],
) => {
  if (!isSecuredRequestId(requestId)) {
    return;
  }
  attachOperationContextHeaders({
    headers,
    requestId,
    target: 'browser',
    method,
    path,
    operationContext,
    operationContract: realOperationContract.get(requestId),
    operationContextHeader: OPERATION_CONTEXT_HEADER,
    operationContextDetailHeader: OPERATION_CONTEXT_DETAIL_HEADER,
  });
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
    const fetcher = resolveConfiguredRequest(realRequest, requestId, fetch);

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

    attachEnvelopeHeaderIfRequired(headers, requestId, finalURL);
    attachSecuredOperationHeaders(
      headers,
      requestId,
      method,
      path,
      operationContext,
    );

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
  operationContext,
}) => {
  const getFinalPath = compile(path, { encode: encodeURIComponent });
  const sender: Sender = (...args) => {
    const fetcher = resolveConfiguredRequest(
      realRequest,
      requestId,
      originFetch,
    );

    const { body, headers: uploadHeaders, params } = getUploadPayload(args);
    const headers: Record<string, any> = { ...uploadHeaders };
    const finalPath = getFinalPath(params);

    const configDomain = domainMap.get(requestId);
    const finalURL = `${configDomain || domain || ''}${finalPath}`;

    attachEnvelopeHeaderIfRequired(headers, requestId, finalURL);
    attachSecuredOperationHeaders(
      headers,
      requestId,
      'POST',
      path,
      operationContext,
    );

    return fetcher(finalURL, {
      method: 'POST',
      body,
      headers,
    });
  };

  return sender;
};

export * from './requestContext';
export * from './traceparent';
export * from './types';
