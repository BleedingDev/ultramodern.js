// @effect-diagnostics strictBooleanExpressions:off
import {
  BFF_LOCALE_HEADER,
  BFF_OPERATION_CONTEXT_DETAIL_HEADER,
  BFF_OPERATION_CONTEXT_HEADER,
  BFF_TRACEPARENT_HEADER,
  type OperationContext,
  parseTraceparent,
} from '@modern-js/create-request';

export type EffectContext = {
  request: Request;
  env: Record<string, unknown>;
  path: string;
  method: string;
  operationContext: OperationContext;
};

export type EffectContextStorage = {
  getStore: () => EffectContext | undefined;
  run: <TResult>(value: EffectContext, cb: () => TResult) => TResult;
};

export const kEffectContextStorage = Symbol.for(
  'modernjs.plugin-bff.effectContextStorage',
);

export type CreateEffectOperationContextOptions = Omit<
  EffectContext,
  'operationContext'
>;

type OperationContextStringField =
  | 'requestId'
  | 'operationId'
  | 'schemaHash'
  | 'traceparent'
  | 'traceId'
  | 'spanId';

const readHeader = (headers: Headers, header: string) => {
  const value = headers.get(header);
  return value && value.length > 0 ? value : undefined;
};

const copyStringField = (
  target: Partial<OperationContext>,
  details: Record<string, unknown>,
  key: OperationContextStringField,
) => {
  const value = details[key];
  if (typeof value === 'string' && value.length > 0) {
    target[key] = value;
  }
};

const readOperationContextDetails = (
  request: Request,
): Partial<OperationContext> => {
  const rawDetails = readHeader(
    request.headers,
    BFF_OPERATION_CONTEXT_DETAIL_HEADER,
  );
  if (!rawDetails) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawDetails);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const details = parsed as Record<string, unknown>;
    const safeDetails: Partial<OperationContext> = {};
    copyStringField(safeDetails, details, 'requestId');
    copyStringField(safeDetails, details, 'operationId');
    copyStringField(safeDetails, details, 'schemaHash');
    copyStringField(safeDetails, details, 'traceparent');
    copyStringField(safeDetails, details, 'traceId');
    copyStringField(safeDetails, details, 'spanId');
    if (typeof details.operationVersion === 'number') {
      safeDetails.operationVersion = details.operationVersion;
    }
    return safeDetails;
  } catch {
    return {};
  }
};

export const createEffectOperationContext = ({
  request,
  path,
  method,
}: CreateEffectOperationContextOptions): OperationContext => {
  const details = readOperationContextDetails(request);
  const operationDetails = { ...details };
  delete operationDetails.traceparent;
  delete operationDetails.traceId;
  delete operationDetails.spanId;
  const servicePath = new URL(request.url).pathname;
  const headerTraceparent = readHeader(request.headers, BFF_TRACEPARENT_HEADER);
  const headerTraceContext = parseTraceparent(headerTraceparent);
  const detailTraceContext = parseTraceparent(details.traceparent);
  const traceparent = headerTraceContext
    ? headerTraceparent
    : detailTraceContext
      ? details.traceparent
      : undefined;
  const parsedTraceparent =
    headerTraceContext ||
    detailTraceContext ||
    (details.traceId && details.spanId
      ? {
          traceId: details.traceId,
          spanId: details.spanId,
        }
      : undefined);
  const locale = readHeader(request.headers, BFF_LOCALE_HEADER);
  const headerOperationId = readHeader(
    request.headers,
    BFF_OPERATION_CONTEXT_HEADER,
  );

  return {
    ...operationDetails,
    ...(headerOperationId || details.operationId
      ? { operationId: headerOperationId || details.operationId }
      : {}),
    routePath: servicePath,
    method: (method || request.method || 'GET').toUpperCase(),
    source: 'effect-adapter',
    ...(path && path !== servicePath
      ? { attributes: { mountedPath: path } }
      : {}),
    ...(locale ? { locale } : {}),
    ...(traceparent ? { traceparent } : {}),
    ...(parsedTraceparent
      ? {
          traceId: parsedTraceparent.traceId,
          spanId: parsedTraceparent.spanId,
        }
      : {}),
  };
};
