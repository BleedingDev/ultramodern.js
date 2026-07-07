import { storage } from '@modern-js/runtime-utils/node';
import { handleRes } from './handleRes';
import { firstHeaderValue, toOrigin } from './policyCore';
import { createRequestFactory } from './requestFactory';

export {
  CrossOriginEnvelopePolicyError,
  IdentityBindingViolationError,
  OperationContractViolationError,
  ProducerClientNotInitializedError,
  ProducerDomainNotConfiguredError,
} from './policyCore';

type Fetch = typeof fetch;

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

const requestFactory = createRequestFactory<Fetch>({
  target: 'server',
  getFetch: () => fetch,
  originFetch,
  readIncomingHeaders: readIncomingWebHeaders,
  resolveSourceOrigin,
  createInputParamsBody: args => args as any,
  resolveRequestUrl: ({ configDomain, path, port }) =>
    `${configDomain || `http://127.0.0.1:${port}`}${path}`,
  resolveUploadUrl: ({ configDomain, path }) => `${configDomain || ''}${path}`,
});

export const { configure, createRequest, createUploader } = requestFactory;

export * from './requestContext';
export * from './traceparent';
export * from './types';
