// @effect-diagnostics strictBooleanExpressions:off
import {
  BFF_LOCALE_HEADER,
  BFF_OPERATION_CONTEXT_DETAIL_HEADER,
  BFF_OPERATION_CONTEXT_HEADER,
  BFF_TRACEPARENT_HEADER,
  type OperationContext,
} from '@modern-js/create-request';

export type EffectContext = {
  request: Request;
  env: Record<string, unknown>;
  path: string;
  method: string;
  operationContext: OperationContext;
};

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

const TRACEPARENT_REGEX = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/i;

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

const parseTraceparent = (traceparent?: string) => {
  if (!traceparent) {
    return undefined;
  }

  const match = traceparent.trim().match(TRACEPARENT_REGEX);
  if (!match) {
    return undefined;
  }

  const [, traceId, spanId] = match;
  if (!traceId || !spanId) {
    return undefined;
  }

  return {
    traceId: traceId.toLowerCase(),
    spanId: spanId.toLowerCase(),
  };
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
  const servicePath = new URL(request.url).pathname;
  const traceparent =
    readHeader(request.headers, BFF_TRACEPARENT_HEADER) || details.traceparent;
  const parsedTraceparent =
    details.traceId && details.spanId
      ? {
          traceId: details.traceId,
          spanId: details.spanId,
        }
      : parseTraceparent(traceparent);
  const locale = readHeader(request.headers, BFF_LOCALE_HEADER);
  const headerOperationId = readHeader(
    request.headers,
    BFF_OPERATION_CONTEXT_HEADER,
  );

  return {
    ...details,
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
