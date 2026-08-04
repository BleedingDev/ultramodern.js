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
  api: HttpApi.Constraint,
  openapi: EffectBffOpenApiConfig | undefined,
) {
  const openApiOptions = getOpenApiOptions(openapi);
  if (!openApiOptions) {
    return null;
  }

  // effect 4.0.0-beta.98 made `HttpApi`'s `Groups` parameter invariant, so no
  // concrete api is assignable to the widened `HttpApi.Top` instance type.
  // `HttpApi.Constraint` is the erased bound every api satisfies; `fromApi`
  // only reads runtime properties, which `Top` preserves.
  return HttpRouter.add(
    'GET',
    openApiOptions.path,
    HttpServerResponse.jsonUnsafe(OpenApi.fromApi(api as HttpApi.Top)),
  );
}
