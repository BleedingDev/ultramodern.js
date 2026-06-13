import type { Monitors } from '@modern-js/types';
import { parseHeaders } from './request';

const ERROR_PAGE_TEXT: Record<number, string> = {
  404: 'This page could not be found.',
  500: 'Internal Server Error.',
};

const SAFE_FAILURE_MESSAGES: Record<number, string> = {
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

const SAFE_FAILURE_CODES: Record<number, string> = {
  500: 'INTERNAL_SERVER_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};

export type SafeFailureEnvelope = {
  success: false;
  error: {
    code: string;
    message: string;
    status: number;
  };
};

export type SafeFailureHttpResult = {
  status: number;
  body: SafeFailureEnvelope;
  headers: Record<string, string>;
};

const readErrorProperty = (error: unknown, key: string): unknown => {
  if (typeof error !== 'object' || error === null || !(key in error)) {
    return undefined;
  }
  return (error as Record<string, unknown>)[key];
};

const normalizeFailureStatus = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return undefined;
  }
  return value >= 400 && value <= 599 ? value : undefined;
};

const normalizeRetryAfter = (value: unknown): string | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return String(Math.ceil(value));
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (value instanceof Date) {
    return value.toUTCString();
  }
  return undefined;
};

export const getSafeFailureStatus = (error: unknown): number =>
  normalizeFailureStatus(readErrorProperty(error, 'status')) ??
  normalizeFailureStatus(readErrorProperty(error, 'statusCode')) ??
  500;

export const createSafeFailureHttpResult = (
  error: unknown,
): SafeFailureHttpResult => {
  const status = getSafeFailureStatus(error);
  const retryAfter =
    status === 503
      ? (normalizeRetryAfter(readErrorProperty(error, 'retryAfter')) ??
        normalizeRetryAfter(readErrorProperty(error, 'retryAfterSeconds')) ??
        normalizeRetryAfter(
          typeof readErrorProperty(error, 'retryAfterMs') === 'number'
            ? (readErrorProperty(error, 'retryAfterMs') as number) / 1000
            : undefined,
        ))
      : undefined;

  return {
    status,
    body: {
      success: false,
      error: {
        code: SAFE_FAILURE_CODES[status] ?? 'REQUEST_FAILED',
        message: SAFE_FAILURE_MESSAGES[status] ?? 'Request failed',
        status,
      },
    },
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(retryAfter ? { 'Retry-After': retryAfter } : {}),
    },
  };
};

export const createSafeJsonFailureResponse = (error: unknown): Response => {
  const result = createSafeFailureHttpResult(error);
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: result.headers,
  });
};

export const createErrorHtml = (status: number) => {
  const text = ERROR_PAGE_TEXT[status] || '';
  const title = `${status}: ${text}`;
  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width">
    <title>${title}</title>
    <style>
      html,body {
        margin: 0;
      }

      .page-container {
        color: #000;
        background: #fff;
        height: 100vh;
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
      }
    </style>
  </head>
  <body>
    <div class="page-container">
    <h1>${status}</h1>
    <div>${text}</div>
  </body>
  </html>
  `;
};

export enum ErrorDigest {
  ENOTF = 'Page could not be found',
  EINTER = 'Internal server error',
  ERENDER = 'SSR render fallback',
  // INIT: 'Server init error',
  // WARMUP: 'SSR warmup failed',
  // EMICROINJ: 'Get micro-frontend info failed',
}

export function onError(
  digest: ErrorDigest,
  error: Error | string,
  monitors?: Monitors,
  req?: Request,
) {
  const headerData = req && parseHeaders(req);

  headerData && delete headerData.cookie;

  if (monitors) {
    monitors.error(
      req
        ? `Server Error - ${digest}, error = %s, req.url = %s, req.headers = %o`
        : `Server Error - ${digest}, error = %s`,
      error instanceof Error ? error.stack || error.message : error,
      req?.url,
      headerData,
    );
  } else if (req) {
    console.error(
      `Server Error - ${digest}, error = ${
        error instanceof Error ? error.stack || error.message : error
      }, req.url = ${req.url}, req.headers = ${JSON.stringify(headerData)}`,
    );
  } else {
    console.error(
      `Server Error - ${digest}, error = ${
        error instanceof Error ? error.stack || error.message : error
      } `,
    );
  }
}
