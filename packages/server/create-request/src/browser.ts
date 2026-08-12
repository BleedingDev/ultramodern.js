import { handleRes } from './handleRes';
import { createRequestFactory } from './requestFactory';

export {
  CrossOriginEnvelopePolicyError,
  IdentityBindingViolationError,
  OperationContractViolationError,
  ProducerClientNotInitializedError,
  ProducerDomainNotConfiguredError,
} from './policyCore';

const resolveBrowserOrigin = () =>
  typeof window !== 'undefined' ? window.location.origin : undefined;

const originFetch = (...params: Parameters<typeof fetch>) => {
  const [url, init] = params;

  if (init?.method?.toLowerCase() === 'get') {
    init.body = undefined;
  }
  return fetch(url, init).then(handleRes);
};

const requestFactory = createRequestFactory<typeof fetch>({
  target: 'browser',
  getFetch: () => fetch,
  originFetch,
  readIncomingHeaders: () => ({}),
  resolveSourceOrigin: resolveBrowserOrigin,
  createInputParamsBody: args =>
    JSON.stringify({
      args,
    }),
  resolveRequestUrl: ({ configDomain, domain, path }) =>
    `${configDomain || domain || ''}${path}`,
  resolveUploadUrl: ({ configDomain, domain, path }) =>
    `${configDomain || domain || ''}${path}`,
});

export const { configure, createRequest, createUploader } = requestFactory;

export * from './requestContext';
export * from './traceparent';
export * from './types';
