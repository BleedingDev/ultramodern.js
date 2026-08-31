import { compile } from 'path-to-regexp';
import { stringify } from 'qs';
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
  TransportTarget,
  UploadCreator,
} from './types';
import {
  BFF_DEFAULT_PROTECTED_IDENTITY_HEADERS,
  BFF_OPERATION_CONTEXT_DETAIL_HEADER,
  BFF_ENVELOPE_HEADER as ENVELOPE_HEADER,
  BFF_OPERATION_CONTEXT_HEADER as OPERATION_CONTEXT_HEADER,
} from './types';
import { getUploadPayload } from './utiles';

type HeaderMap = Record<string, any>;
type RequestUrlOptions = {
  configDomain: string | undefined;
  domain: string | undefined;
  path: string;
  port: number;
};
type UploadUrlOptions = {
  configDomain: string | undefined;
  domain: string | undefined;
  path: string;
};

type RequestFactoryEnvironment<F> = {
  target: TransportTarget;
  getFetch: () => F;
  originFetch: F;
  readIncomingHeaders: () => HeaderMap;
  resolveSourceOrigin: (incomingHeaders: HeaderMap) => string | undefined;
  createInputParamsBody: (args: any[]) => any;
  resolveRequestUrl: (options: RequestUrlOptions) => string;
  resolveUploadUrl: (options: UploadUrlOptions) => string;
};

const OPERATION_CONTEXT_DETAIL_HEADER =
  BFF_OPERATION_CONTEXT_DETAIL_HEADER satisfies 'x-modernjs-bff-operation-context';

export const createRequestFactory = <F>(
  environment: RequestFactoryEnvironment<F>,
) => {
  const isServerTarget = environment.target === 'server';
  const realRequest: Map<string, F> = new Map();
  const realAllowedHeaders: Map<string, string[]> = new Map();
  const realResolveHeaders: Map<string, ResolveHeaders> = new Map();
  const realRequireEnvelope: Map<string, boolean> = new Map();
  const realAllowCrossOriginEnvelope: Map<string, AllowCrossOriginEnvelope> =
    new Map();
  const realTransportResilience: Map<string, TransportResilienceOptions> =
    new Map();
  const realIdentityBinding: Map<string, IdentityBindingOptions> = new Map();
  const realOperationContract: Map<string, OperationContractOptions> =
    new Map();
  const domainMap: Map<string, string> = new Map();

  const attachEnvelopeHeaderIfRequired = (
    headers: HeaderMap,
    requestId: string,
    url: string,
    incomingHeaders: HeaderMap,
  ) => {
    const shouldRequireEnvelope =
      realRequireEnvelope.get(requestId) ?? isSecuredRequestId(requestId);
    if (!shouldRequireEnvelope) {
      return;
    }

    headers[ENVELOPE_HEADER] = buildEnvelopeHeaderValue({
      requestId,
      target: environment.target,
      sourceOrigin: environment.resolveSourceOrigin(incomingHeaders),
      targetOrigin: toOrigin(url),
      traceContext: parseTraceparentValue(
        readHeader(headers, TRACEPARENT_HEADER),
      ),
      allowCrossOriginEnvelope: realAllowCrossOriginEnvelope.get(requestId),
    });
  };

  const attachSecuredOperationHeaders = (
    headers: HeaderMap,
    requestId: string,
    method: string,
    path: string,
    operationContext: RequestCreatorOptions<F>['operationContext'],
  ) => {
    if (!isSecuredRequestId(requestId)) {
      return;
    }
    attachOperationContextHeaders({
      headers,
      requestId,
      target: environment.target,
      method,
      path,
      operationContext,
      operationContract: realOperationContract.get(requestId),
      operationContextHeader: OPERATION_CONTEXT_HEADER,
      operationContextDetailHeader: OPERATION_CONTEXT_DETAIL_HEADER,
    });
  };

  const applyIdentityAndForwardedHeaders = (
    headers: HeaderMap,
    requestId: string,
    incomingHeaders: HeaderMap,
  ) => {
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
    const forwardedHeaders: HeaderMap = {};
    if (isServerTarget) {
      for (const key of targetAllowedHeaders) {
        const incomingValue = readHeader(incomingHeaders, key);
        if (typeof incomingValue !== 'undefined') {
          writeHeader(forwardedHeaders, key, incomingValue);
        }
      }
    }

    if (identityBindingEnabled) {
      const derivedIdentityHeaders: HeaderMap = {};
      if (isServerTarget) {
        for (const header of protectedIdentityHeaders) {
          const incomingHeaderValue = readHeader(incomingHeaders, header);
          if (typeof incomingHeaderValue !== 'undefined') {
            writeHeader(derivedIdentityHeaders, header, incomingHeaderValue);
          }
        }
      }

      const customDerivedHeaders = identityBinding?.deriveHeaders?.({
        requestId,
        target: environment.target,
        incomingHeaders: isServerTarget ? { ...incomingHeaders } : {},
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
          target: environment.target,
          header,
          attemptedValue,
          derivedValue: readHeader(derivedIdentityHeaders, header),
          reason: 'client_override_blocked',
        };
        identityBinding?.onViolation?.(violation);

        if (identityBindingStrict) {
          throw new IdentityBindingViolationError(violation);
        }

        deleteHeader(headers, header);
      }

      Object.keys(derivedIdentityHeaders).forEach(header => {
        if (isServerTarget) {
          writeHeader(forwardedHeaders, header, derivedIdentityHeaders[header]);
        } else {
          writeHeader(headers, header, derivedIdentityHeaders[header]);
        }
      });
    }

    if (isServerTarget) {
      const resolveHeaders = realResolveHeaders.get(requestId);
      if (resolveHeaders) {
        const resolvedHeaders = resolveHeaders({
          requestId,
          allowedHeaders: targetAllowedHeaders,
          incomingHeaders: { ...forwardedHeaders },
        });
        if (resolvedHeaders && typeof resolvedHeaders === 'object') {
          for (const key of targetAllowedHeaders) {
            const resolvedValue = readHeader(resolvedHeaders, key);
            if (typeof resolvedValue !== 'undefined') {
              if (
                identityBindingEnabled &&
                protectedIdentityHeaders.includes(key.toLowerCase())
              ) {
                writeHeader(forwardedHeaders, key.toLowerCase(), resolvedValue);
                continue;
              }
              writeHeader(forwardedHeaders, key, resolvedValue);
            }
          }
        }
      }
    }

    if (isServerTarget) {
      for (const [header, value] of Object.entries(forwardedHeaders)) {
        writeHeader(headers, header, value);
      }
    }

    return headers;
  };

  const configure = (options: IOptions<F>) => {
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

    let configuredRequest = request || environment.originFetch;
    if (interceptor && !request) {
      configuredRequest = interceptor(environment.getFetch());
    }

    let resolvedDomain: string | undefined;
    if (setDomain) {
      resolvedDomain = setDomain({
        target: environment.target,
        requestId,
      });
      if (requestId !== 'default' && isEmptyDomain(resolvedDomain)) {
        throw new ProducerDomainNotConfiguredError(requestId);
      }
    }

    realAllowedHeaders.delete(requestId);
    realResolveHeaders.delete(requestId);
    realTransportResilience.delete(requestId);
    realIdentityBinding.delete(requestId);
    realOperationContract.delete(requestId);
    realRequireEnvelope.delete(requestId);
    realAllowCrossOriginEnvelope.delete(requestId);

    if (Array.isArray(allowedHeaders)) {
      realAllowedHeaders.set(requestId, allowedHeaders);
    }
    if (isServerTarget && typeof resolveHeaders === 'function') {
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
    if (typeof resolvedDomain === 'string') {
      domainMap.set(requestId, resolvedDomain);
    }
    realRequest.set(requestId, configuredRequest);
  };

  const createRequest: RequestCreator<F> = ((
    ...args: Parameters<RequestCreator<F>>
  ) => {
    const options: RequestCreatorOptions<F> =
      typeof args[0] === 'object' && args[0] !== null
        ? args[0]
        : {
            path: args[0],
            method: args[1],
            port: args[2],
            httpMethodDecider: args[3],
            fetch: args[4],
            requestId: args[5],
            operationContext: args[6],
          };
    const {
      path,
      method,
      port,
      httpMethodDecider = 'functionName',
      fetch = environment.originFetch,
      domain,
      requestId = 'default',
      operationContext,
    } = options;
    const getFinalPath = compile(path, { encode: encodeURIComponent });
    const keyNames = extractPathParamNames(path);

    const send = (...senderArgs: any[]) => {
      const fetcher = resolveConfiguredRequest(realRequest, requestId, fetch);
      const incomingHeaders = environment.readIncomingHeaders();

      let body;
      let headers: HeaderMap;
      let url: string;

      if (httpMethodDecider === 'inputParams') {
        const configDomain = domainMap.get(requestId);
        if (requestId !== 'default' && isEmptyDomain(configDomain)) {
          throw new ProducerDomainNotConfiguredError(requestId);
        }
        url = environment.resolveRequestUrl({
          configDomain,
          domain,
          port,
          path,
        });
        body = environment.createInputParamsBody(senderArgs);
        headers = {
          'Content-Type': 'application/json',
        };
        headers = applyIdentityAndForwardedHeaders(
          headers,
          requestId,
          incomingHeaders,
        );
      } else {
        const payload: BFFRequestPayload =
          typeof senderArgs[senderArgs.length - 1] === 'object'
            ? senderArgs[senderArgs.length - 1]
            : {};
        payload.params = payload.params || {};

        const requestParams = senderArgs[0];
        if (typeof requestParams === 'object' && requestParams.params) {
          const { params } = requestParams;
          keyNames.forEach(keyName => {
            payload.params![keyName] = params[keyName];
          });
        } else {
          keyNames.forEach((keyName, index) => {
            payload.params![keyName] = senderArgs[index];
          });
        }

        const plainPath = getFinalPath(payload.params);
        const finalPath = payload.query
          ? `${plainPath}?${stringify(payload.query)}`
          : plainPath;
        headers = payload.headers ? { ...payload.headers } : {};

        headers = applyIdentityAndForwardedHeaders(
          headers,
          requestId,
          incomingHeaders,
        );

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
        } else if (payload.formUrlencoded) {
          headers['Content-Type'] = 'application/x-www-form-urlencoded';
          body =
            !isServerTarget &&
            typeof URLSearchParams !== 'undefined' &&
            payload.formUrlencoded instanceof URLSearchParams
              ? payload.formUrlencoded
              : typeof payload.formUrlencoded === 'object'
                ? stringify(payload.formUrlencoded)
                : payload.formUrlencoded;
        }

        const configDomain = domainMap.get(requestId);
        if (requestId !== 'default' && isEmptyDomain(configDomain)) {
          throw new ProducerDomainNotConfiguredError(requestId);
        }
        url = environment.resolveRequestUrl({
          configDomain,
          domain,
          port,
          path: finalPath,
        });
      }

      if (!isServerTarget) {
        writeHeader(headers, 'accept', `application/json,*/*;q=0.8`);
      }

      if (isServerTarget) {
        if (typeof readHeader(headers, TRACEPARENT_HEADER) === 'undefined') {
          const incomingTraceparent = firstHeaderValue(
            readHeader(incomingHeaders, TRACEPARENT_HEADER),
          );
          if (typeof incomingTraceparent === 'string') {
            writeHeader(headers, TRACEPARENT_HEADER, incomingTraceparent);
          }
        }
        if (
          typeof readHeader(headers, TRACEPARENT_HEADER) === 'undefined' &&
          operationContext?.traceparent
        ) {
          writeHeader(
            headers,
            TRACEPARENT_HEADER,
            operationContext.traceparent,
          );
        }
      }
      attachEnvelopeHeaderIfRequired(headers, requestId, url, incomingHeaders);
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

      if (isServerTarget) {
        writeHeader(headers, 'accept', `application/json,*/*;q=0.8`);
      }

      return executeWithResilience({
        requestId,
        target: environment.target,
        method,
        url,
        init: {
          method,
          body,
          headers,
        },
        fetcher: fetcher as (...args: any[]) => Promise<any>,
        transport: realTransportResilience.get(requestId),
      });
    };

    const sender: Sender<F> = isServerTarget
      ? send
      : async (...senderArgs: any[]) => send(...senderArgs);

    return sender;
  }) as RequestCreator<F>;

  const createUploader: UploadCreator = ({
    path,
    domain,
    requestId = 'default',
    operationContext,
  }) => {
    const getUploadPath = isServerTarget
      ? undefined
      : compile(path, { encode: encodeURIComponent });

    const sender: Sender = (...args) => {
      const fetcher = resolveConfiguredRequest(
        realRequest,
        requestId,
        environment.originFetch,
      );
      const { body, headers: uploadHeaders, params } = getUploadPayload(args);
      let headers: HeaderMap = { ...uploadHeaders };
      const finalPath = getUploadPath ? getUploadPath(params) : path;

      const configDomain = domainMap.get(requestId);
      const finalURL = environment.resolveUploadUrl({
        configDomain,
        domain,
        path: finalPath,
      });
      const incomingHeaders = environment.readIncomingHeaders();
      headers = applyIdentityAndForwardedHeaders(
        headers,
        requestId,
        incomingHeaders,
      );

      attachEnvelopeHeaderIfRequired(
        headers,
        requestId,
        finalURL,
        incomingHeaders,
      );
      attachSecuredOperationHeaders(
        headers,
        requestId,
        'POST',
        path,
        operationContext,
      );

      return executeWithResilience({
        requestId,
        target: environment.target,
        method: 'POST',
        url: finalURL,
        init: {
          method: 'POST',
          body,
          headers,
        },
        fetcher: fetcher as (...args: any[]) => Promise<any>,
        transport: realTransportResilience.get(requestId),
      });
    };

    return sender;
  };

  return {
    configure,
    createRequest,
    createUploader,
  };
};
