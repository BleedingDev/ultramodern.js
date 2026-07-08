import 'reflect-metadata';
import type { ResponseMeta } from '../operators/http';
import type { APIHandlerInfo, ApiHandler } from '../router';
import {
  type CrossProjectPolicyConfig,
  type CrossProjectPolicyViolation,
  evaluateCrossProjectPolicy,
} from '../security/crossProjectPolicy';
import { HttpMetadata, HttpMethod } from '../types';
import { isInputParamsDeciderHandler, isWithMetaHandler } from '../utils';

/** Lowercase route-registration method shared by supported adapter routers. */
export type ApiRouteMethod = Lowercase<`${HttpMethod}`>;

const API_ROUTE_METHODS: Record<HttpMethod, ApiRouteMethod> = {
  [HttpMethod.Get]: 'get',
  [HttpMethod.Post]: 'post',
  [HttpMethod.Put]: 'put',
  [HttpMethod.Delete]: 'delete',
  [HttpMethod.Connect]: 'connect',
  [HttpMethod.Trace]: 'trace',
  [HttpMethod.Patch]: 'patch',
  [HttpMethod.Options]: 'options',
  [HttpMethod.Head]: 'head',
};

/**
 * Maps an `APIHandlerInfo.httpMethod` onto the lowercase router method.
 * Unknown methods fail fast with a descriptive error instead of the
 * `app[method] is not a function` TypeError the adapters used to throw.
 */
export const toApiRouteMethod = (
  httpMethod: APIHandlerInfo['httpMethod'],
): ApiRouteMethod => {
  const method = API_ROUTE_METHODS[httpMethod];
  if (!method) {
    throw new Error(
      `[bff-core] Unsupported HTTP method "${String(httpMethod)}" in API handler info`,
    );
  }
  return method;
};

/** Route middlewares attached by BFF operators via reflect metadata. */
export const getRouteMiddlewares = <Middleware = unknown>(
  handler: ApiHandler,
): Middleware[] => {
  const middlewares: unknown = Reflect.getMetadata('middleware', handler);
  return Array.isArray(middlewares) ? (middlewares as Middleware[]) : [];
};

export type ApiRoutePlanEntry<Middleware = unknown> = {
  method: ApiRouteMethod;
  routePath: string;
  handler: ApiHandler;
  middlewares: Middleware[];
};

/**
 * Computes the framework-agnostic registration plan for a set of API
 * handlers: registration order, lowercase route method and operator
 * middlewares. Adapters only translate each entry into framework calls.
 */
export const planApiRoutes = <Middleware = unknown>(
  handlerInfos: APIHandlerInfo[],
): ApiRoutePlanEntry<Middleware>[] =>
  handlerInfos.map(({ routePath, handler, httpMethod }) => ({
    method: toApiRouteMethod(httpMethod),
    routePath,
    handler,
    middlewares: getRouteMiddlewares<Middleware>(handler),
  }));

/**
 * Marker used by `@modern-js/bff-runtime` schema handlers. Re-declared here
 * (value-compatible) so adapters do not need a runtime dependency on
 * `@modern-js/bff-runtime` just to detect the handler mode.
 */
export const HANDLER_WITH_SCHEMA = 'HANDLER_WITH_SCHEMA';

export const isSchemaApiHandler = (handler: unknown): boolean => {
  if (typeof handler !== 'function') {
    return false;
  }
  const marked = handler as unknown as Record<string, unknown>;
  return marked[HANDLER_WITH_SCHEMA] === true;
};

export type ApiHandlerMode = 'meta' | 'schema' | 'inputParamsDecider' | 'plain';

/**
 * Detects how an API handler expects to be invoked. The probe order (meta →
 * schema → input-params-decider → plain) is shared by every adapter.
 *
 * Adapters call this once at route-registration time, not per request:
 * meta/schema markers are attached by decorators at module load, so a handler
 * marked after registration would not be picked up.
 */
export const getApiHandlerMode = (handler: ApiHandler): ApiHandlerMode => {
  if (isWithMetaHandler(handler)) {
    return 'meta';
  }
  if (isSchemaApiHandler(handler)) {
    return 'schema';
  }
  if (isInputParamsDeciderHandler(handler)) {
    return 'inputParamsDecider';
  }
  return 'plain';
};

/** Result envelope produced by `@modern-js/bff-runtime` schema handlers. */
export type SchemaHandlerResult =
  | { type: 'HandleSuccess'; value: unknown }
  | {
      type: 'InputValidationError' | 'OutputValidationError';
      message: unknown;
    };

export type SchemaHandlerHttpOutcome = {
  success: boolean;
  status: number;
  body: unknown;
};

/**
 * Maps a schema-handler result onto the HTTP outcome both adapters must
 * produce: 200/value on success, 400/message on input validation errors and
 * 500/message for any other failure.
 */
export const mapSchemaHandlerResult = (
  result: SchemaHandlerResult,
): SchemaHandlerHttpOutcome => {
  if (result.type === 'HandleSuccess') {
    return { success: true, status: 200, body: result.value };
  }
  return {
    success: false,
    status: result.type === 'InputValidationError' ? 400 : 500,
    body: result.message,
  };
};

/**
 * Reads the response metadata (headers/redirect/status) attached to a meta
 * handler. Returns an empty list when no metadata is present so adapters can
 * iterate unconditionally.
 */
export const getResponseMetaList = (handler: ApiHandler): ResponseMeta[] => {
  const responseMeta: unknown = Reflect.getMetadata(
    HttpMetadata.Response,
    handler,
  );
  return Array.isArray(responseMeta) ? (responseMeta as ResponseMeta[]) : [];
};

export type ApiHandlerInput = {
  params: Record<string, unknown>;
} & Record<string, unknown>;

/**
 * Positional invocation convention for plain function handlers: route params
 * in declaration order followed by the full input object.
 */
export const buildPositionalHandlerArgs = (
  input: ApiHandlerInput,
  routePath?: string,
): unknown[] => {
  const paramNames =
    routePath?.match(/:(\w+)/g)?.map(param => param.slice(1)) ?? [];
  const positionalParams =
    paramNames.length > 0
      ? paramNames.map(param => input.params[param])
      : Object.values(input.params);

  return [...positionalParams, input];
};

export type CrossProjectPolicyDenial = {
  status: number;
  body: {
    code: CrossProjectPolicyViolation['code'];
    reason: CrossProjectPolicyViolation['reason'];
    message: string;
  };
};

/**
 * Evaluates the cross-project policy for a request and, on violation,
 * returns the exact HTTP status and JSON body every adapter must send.
 */
export const checkCrossProjectPolicy = (
  headers: Record<string, unknown>,
  policy: CrossProjectPolicyConfig | undefined,
): CrossProjectPolicyDenial | null => {
  const violation = evaluateCrossProjectPolicy(headers, policy);
  if (!violation) {
    return null;
  }
  return {
    status: violation.status,
    body: {
      code: violation.code,
      reason: violation.reason,
      message: violation.message,
    },
  };
};
