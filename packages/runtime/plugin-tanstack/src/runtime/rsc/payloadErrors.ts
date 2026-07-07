// @effect-diagnostics asyncFunction:off globalFetch:off processEnv:off strictBooleanExpressions:off
import type { ServerPayload } from '@modern-js/runtime/context';
import { isRouteErrorResponse } from '@modern-js/runtime-utils/router';

export function shouldRedactServerError(status = 500) {
  return (
    status >= 500 &&
    process.env.NODE_ENV !== 'development' &&
    process.env.NODE_ENV !== 'test'
  );
}

export function serializePayloadError(error: unknown): unknown {
  if (isRouteErrorResponse(error)) {
    if (shouldRedactServerError(error.status)) {
      return {
        status: error.status,
        statusText: 'Internal Server Error',
        data: 'Unexpected Server Error',
        __type: 'RouteErrorResponse',
      };
    }

    return { ...error, __type: 'RouteErrorResponse' };
  }

  if (error instanceof Error) {
    if (shouldRedactServerError()) {
      return {
        message: 'Unexpected Server Error',
        stack: undefined,
        __type: 'Error',
      };
    }

    return {
      message: error.message,
      stack: error.stack,
      __type: 'Error',
      ...(error.name !== 'Error' ? { __subType: error.name } : {}),
    };
  }

  if (shouldRedactServerError()) {
    return {
      message: 'Unexpected Server Error',
      stack: undefined,
      __type: 'Error',
    };
  }

  return error;
}

export function isSerializedNotFound(value: unknown) {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    (value as { isNotFound?: unknown }).isNotFound === true
  );
}

export function toRouteErrors(payload: ServerPayload) {
  return payload.errors && typeof payload.errors === 'object'
    ? (payload.errors as Record<string, unknown>)
    : {};
}

export function toRouteLoaderData(payload: ServerPayload) {
  return payload.loaderData && typeof payload.loaderData === 'object'
    ? (payload.loaderData as Record<string, unknown>)
    : {};
}
