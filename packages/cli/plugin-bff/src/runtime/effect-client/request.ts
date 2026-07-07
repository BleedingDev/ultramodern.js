// @effect-diagnostics processEnv:off strictBooleanExpressions:off
import { isRecord } from './guards';

const METHODS_WITHOUT_BODY = new Set(['GET', 'DELETE', 'HEAD', 'OPTIONS']);

export const normalizeRequest = (
  method: string,
  request: unknown,
): Record<string, unknown> => {
  if (!isRecord(request)) {
    return {};
  }

  const payload: Record<string, unknown> = { ...request };

  if (isRecord(request.path) && !isRecord(payload.params)) {
    payload.params = request.path;
  }

  if (isRecord(request.urlParams) && !isRecord(payload.query)) {
    payload.query = request.urlParams;
  }

  if (isRecord(request.headers) && !isRecord(payload.headers)) {
    payload.headers = request.headers;
  }

  if ('payload' in request && request.payload !== undefined) {
    if (
      typeof FormData !== 'undefined' &&
      request.payload instanceof FormData &&
      !('formData' in payload)
    ) {
      payload.formData = request.payload;
    } else if (METHODS_WITHOUT_BODY.has(method)) {
      if (isRecord(request.payload)) {
        payload.query = isRecord(payload.query)
          ? { ...payload.query, ...request.payload }
          : request.payload;
      } else if (!('body' in payload)) {
        payload.body = request.payload;
      }
    } else if (isRecord(request.payload) && !('data' in payload)) {
      payload.data = request.payload;
    } else if (!('body' in payload)) {
      payload.body = request.payload;
    }
  }

  return payload;
};
