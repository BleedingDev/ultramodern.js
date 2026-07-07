// @effect-diagnostics anyUnknownInErrorContext:off asyncFunction:off globalDate:off globalTimers:off newPromise:off strictBooleanExpressions:off
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http';
import { type HttpApi, OpenApi } from 'effect/unstable/httpapi';

import type { EffectBffOpenApiConfig } from './types';

function normalizeOpenApiPath(pathname: string) {
  if (!pathname.startsWith('/')) {
    return `/${pathname}` as `/${string}`;
  }
  return pathname as `/${string}`;
}

function getOpenApiOptions(openapi: EffectBffOpenApiConfig | undefined) {
  if (!openapi || typeof openapi !== 'object') {
    return undefined;
  }
  if (!openapi.path) {
    return undefined;
  }
  return {
    path: normalizeOpenApiPath(openapi.path),
  };
}

export function createOpenApiLayer(
  api: HttpApi.AnyWithProps,
  openapi: EffectBffOpenApiConfig | undefined,
) {
  const openApiOptions = getOpenApiOptions(openapi);
  if (!openApiOptions) {
    return null;
  }

  return HttpRouter.add(
    'GET',
    openApiOptions.path,
    HttpServerResponse.jsonUnsafe(OpenApi.fromApi(api)),
  );
}
