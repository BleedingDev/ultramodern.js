// @effect-diagnostics anyUnknownInErrorContext:off asyncFunction:off globalDate:off globalTimers:off newPromise:off strictBooleanExpressions:off
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http';
import { type HttpApi, OpenApi } from 'effect/unstable/httpapi';

import type { EffectBffOpenApiConfig } from './types';

const DEFAULT_OPENAPI_PATH = '/openapi.json';

function normalizeOpenApiPath(pathname: string) {
  if (!pathname.startsWith('/')) {
    return `/${pathname}` as `/${string}`;
  }
  return pathname as `/${string}`;
}

function getOpenApiOptions(openapi: EffectBffOpenApiConfig | undefined) {
  if (openapi === false || openapi === undefined) {
    return undefined;
  }

  const path = openapi === true ? DEFAULT_OPENAPI_PATH : openapi.path;
  return {
    path: normalizeOpenApiPath(path ?? DEFAULT_OPENAPI_PATH),
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
