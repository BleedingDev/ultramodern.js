/* eslint-disable no-param-reassign */
import { BaseSSRServerContext, Logger, Metrics } from '@modern-js/types';
import { headersWithoutCookie } from '../../utils';

const TRACEPARENT_REGEX = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;

const parseTraceparent = (
  value: string | string[] | undefined,
): { traceId: string; spanId: string } | null => {
  const traceparent = Array.isArray(value) ? value[0] : value;
  if (!traceparent) {
    return null;
  }

  const match = traceparent.trim().match(TRACEPARENT_REGEX);
  if (!match?.[1] || !match?.[2]) {
    return null;
  }

  return {
    traceId: match[1].toLowerCase(),
    spanId: match[2].toLowerCase(),
  };
};

export const createMetrics = (
  context: BaseSSRServerContext,
  metrics: Metrics,
) => {
  const { entryName: entry, request } = context;
  const { pathname = '', headers = {} } = request || {};
  const traceContext = parseTraceparent(headers.traceparent);

  const emitTimer = (
    name: string,
    cost: number,
    tags: Record<string, unknown> = {},
  ) => {
    metrics.emitTimer(name, cost, {
      pathname,
      entry,
      ...(traceContext
        ? {
            trace_id: traceContext.traceId,
            span_id: traceContext.spanId,
          }
        : {}),
      ...tags,
    });
  };

  const emitCounter = (
    name: string,
    counter: number,
    tags: Record<string, unknown> = {},
  ) => {
    metrics.emitCounter(name, counter, {
      pathname,
      entry,
      ...(traceContext
        ? {
            trace_id: traceContext.traceId,
            span_id: traceContext.spanId,
          }
        : {}),
      ...tags,
    });
  };

  return { emitTimer, emitCounter };
};

export const createLogger = (
  serverContext: BaseSSRServerContext,
  logger: Logger,
) => {
  const request = serverContext.request || {};
  const { headers = {}, pathname = '' } = request;

  const debug = (message: string, ...args: any[]) => {
    logger.debug(`SSR Debug - ${message}, req.url = %s`, ...args, pathname);
  };

  const info = (message: string, ...args: any[]) => {
    logger.info(`SSR Info - ${message}, req.url = %s`, ...args, pathname);
  };

  const error = (message: string, e: Error | string) => {
    if (!e) {
      e = message;
      message = '';
    }

    logger.error(
      `SSR Error - ${message}, error = %s, req.url = %s, req.headers = %o`,
      e instanceof Error ? e.stack || e.message : e,
      pathname,
      headersWithoutCookie(headers),
    );
  };

  return {
    error,
    info,
    debug,
  };
};
/* eslint-enable no-param-reassign */
