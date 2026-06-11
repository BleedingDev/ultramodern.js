import { parseTraceparent } from './traceparent';
import type { OperationContext } from './types';

export const BFF_LOCALE_HEADER = 'accept-language';
export const BFF_TRACEPARENT_HEADER = 'traceparent';

export type RequestContextInput = {
  headers?: Record<string, unknown>;
  locale?: string;
  traceparent?: string;
  operationContext?: OperationContext;
};

export type RequestContextSnapshot = {
  headers: Record<string, string>;
  locale?: string;
  traceparent?: string;
  traceId?: string;
  spanId?: string;
  operationContext?: OperationContext;
};

const readHeader = (
  headers: Record<string, unknown> | undefined,
  header: string,
) => {
  if (!headers) {
    return undefined;
  }

  const normalized = header.toLowerCase();
  const key = Object.keys(headers).find(
    current => current.toLowerCase() === normalized,
  );
  if (!key) {
    return undefined;
  }

  const value = headers[key];
  return Array.isArray(value) ? value[0] : value;
};

const readString = (value: unknown) =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

function createOperationContextSnapshot(
  operationContext: OperationContext | undefined,
  safeContext: Pick<
    OperationContext,
    'locale' | 'traceparent' | 'traceId' | 'spanId'
  >,
): OperationContext | undefined {
  if (!operationContext) {
    return undefined;
  }

  const snapshot: OperationContext = {
    ...operationContext,
    ...(safeContext.locale || operationContext?.locale
      ? { locale: safeContext.locale || operationContext?.locale }
      : {}),
    ...(safeContext.traceparent || operationContext?.traceparent
      ? {
          traceparent: safeContext.traceparent || operationContext?.traceparent,
        }
      : {}),
    ...(safeContext.traceId || operationContext?.traceId
      ? { traceId: safeContext.traceId || operationContext?.traceId }
      : {}),
    ...(safeContext.spanId || operationContext?.spanId
      ? { spanId: safeContext.spanId || operationContext?.spanId }
      : {}),
  };

  return Object.keys(snapshot).some(
    key => typeof snapshot[key as keyof OperationContext] !== 'undefined',
  )
    ? snapshot
    : undefined;
}

export function createRequestContextSnapshot(
  input: RequestContextInput = {},
): RequestContextSnapshot {
  const locale =
    readString(input.locale) ||
    readString(readHeader(input.headers, BFF_LOCALE_HEADER));
  const traceparent =
    readString(input.traceparent) ||
    readString(input.operationContext?.traceparent) ||
    readString(readHeader(input.headers, BFF_TRACEPARENT_HEADER));
  const parsedTraceparent =
    input.operationContext?.traceId && input.operationContext?.spanId
      ? {
          traceId: input.operationContext.traceId,
          spanId: input.operationContext.spanId,
        }
      : parseTraceparent(traceparent);

  const headers: Record<string, string> = {};
  if (locale) {
    headers[BFF_LOCALE_HEADER] = locale;
  }
  if (traceparent) {
    headers[BFF_TRACEPARENT_HEADER] = traceparent;
  }

  const operationContext = createOperationContextSnapshot(
    input.operationContext,
    {
      ...(locale ? { locale } : {}),
      ...(traceparent ? { traceparent } : {}),
      ...(parsedTraceparent
        ? {
            traceId: parsedTraceparent.traceId,
            spanId: parsedTraceparent.spanId,
          }
        : {}),
    },
  );

  return {
    headers,
    ...(locale ? { locale } : {}),
    ...(traceparent ? { traceparent } : {}),
    ...(parsedTraceparent
      ? {
          traceId: parsedTraceparent.traceId,
          spanId: parsedTraceparent.spanId,
        }
      : {}),
    ...(operationContext ? { operationContext } : {}),
  };
}

export function createRequestContextHeaders(
  input: RequestContextInput = {},
): Record<string, string> {
  return createRequestContextSnapshot(input).headers;
}
