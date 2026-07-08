// @effect-diagnostics processEnv:off strictBooleanExpressions:off
import { isRecord } from './guards';
import type {
  EffectRequestContext,
  EffectRequestContextInput,
  EffectRequestRuntime,
} from './types';

export const createEffectRequestContext = (
  createRequestContextHeaders: EffectRequestRuntime['createRequestContextHeaders'],
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

export const applyRequestContext = (
  normalizedRequest: Record<string, unknown>,
  request: unknown,
  createRequestContext: (
    requestContext: EffectRequestContextInput,
  ) => EffectRequestContext,
): Record<string, unknown> => {
  if (!isRecord(request) || !isRecord(request.requestContext)) {
    return normalizedRequest;
  }

  const requestContext = createRequestContext(request.requestContext);
  const requestHeaders = isRecord(requestContext.headers)
    ? requestContext.headers
    : {};

  if (Object.keys(requestHeaders).length === 0) {
    return normalizedRequest;
  }

  return {
    ...normalizedRequest,
    headers: {
      ...(isRecord(normalizedRequest.headers) ? normalizedRequest.headers : {}),
      ...requestHeaders,
    },
  };
};
