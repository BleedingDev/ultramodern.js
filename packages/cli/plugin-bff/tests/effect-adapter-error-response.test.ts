import type { Context, ServerPluginAPI } from '@modern-js/server-core';

import { createEffectAdapterRuntimeErrorResponse } from '../src/runtime/effect/adapter/error-response';

type JsonContext = Context & {
  json: (
    data: unknown,
    statusOrInit?: number | ResponseInit,
    headers?: HeadersInit,
  ) => Response;
};

type SafeFailureBody = {
  success: false;
  error: {
    code: string;
    message: string;
    status: number;
  };
};

const createApi = (
  onError: (
    error: Error,
    context: Context,
  ) => Response | void | Promise<Response | void> = () => {},
): ServerPluginAPI =>
  ({
    getServerConfig() {
      return {
        onError,
      };
    },
  }) as unknown as ServerPluginAPI;

const safeFailureBody = (
  status: number,
  code: string,
  message: string,
): SafeFailureBody => ({
  success: false,
  error: {
    code,
    message,
    status,
  },
});

const readJson = async <T>(response: Response): Promise<T> =>
  (await response.json()) as T;

const leakMarkers = [
  'database-password',
  'hidden-stack',
  'internal-details',
  'root-cause',
  'SECRET_CODE',
  'statusCode',
  'retryAfter',
];

const expectSafeFailureBody = (
  body: SafeFailureBody,
  expectedBody: SafeFailureBody,
) => {
  expect(body).toEqual(expectedBody);
  expect(Object.keys(body.error).sort()).toEqual(['code', 'message', 'status']);

  const serializedBody = JSON.stringify(body);
  for (const marker of leakMarkers) {
    expect(serializedBody).not.toContain(marker);
  }
};

const withProductionEnv = async (callback: () => Promise<void>) => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await callback();
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
  }
};

describe('effect adapter error response safe failure', () => {
  test.each([
    {
      scenario: 'known 404 status error',
      error: Object.assign(new Error('database-password'), {
        status: 404,
        code: 'SECRET_CODE',
        details: 'internal-details',
        stack: 'hidden-stack',
      }),
      expectedStatus: 404,
      expectedBody: safeFailureBody(404, 'REQUEST_FAILED', 'Request failed'),
    },
    {
      scenario: 'known 500 status error',
      error: Object.assign(new Error('database-password'), {
        status: 500,
        statusCode: 404,
        code: 'SECRET_CODE',
        cause: 'root-cause',
        details: 'internal-details',
      }),
      expectedStatus: 500,
      expectedBody: safeFailureBody(
        500,
        'INTERNAL_SERVER_ERROR',
        'Internal Server Error',
      ),
    },
    {
      scenario: 'known 503 statusCode error',
      error: Object.assign(new Error('database-password'), {
        statusCode: 503,
        retryAfter: '120',
        code: 'SECRET_CODE',
        details: 'internal-details',
      }),
      expectedStatus: 503,
      expectedRetryAfter: '120',
      expectedBody: safeFailureBody(
        503,
        'SERVICE_UNAVAILABLE',
        'Service Unavailable',
      ),
    },
  ])('maps $scenario to a safe failure envelope', async ({
    error,
    expectedStatus,
    expectedRetryAfter,
    expectedBody,
  }) => {
    const response = await createEffectAdapterRuntimeErrorResponse(
      createApi(),
      error,
      {} as Context,
    );

    expect(response.status).toBe(expectedStatus);
    expect(response.headers.get('Retry-After')).toBe(
      expectedRetryAfter ?? null,
    );
    expectSafeFailureBody(
      await readJson<SafeFailureBody>(response),
      expectedBody,
    );
  });

  test.each([
    {
      scenario: 'plain Error',
      error: Object.assign(new Error('database-password'), {
        code: 'SECRET_CODE',
        details: 'internal-details',
        stack: 'hidden-stack',
      }),
    },
    {
      scenario: 'unexpected object',
      error: {
        message: 'database-password',
        code: 'SECRET_CODE',
        details: 'internal-details',
        stack: 'hidden-stack',
        statusCode: '503',
        retryAfter: '120',
      },
    },
    {
      scenario: 'unexpected primitive',
      error: 'database-password',
    },
  ])('redacts $scenario internals in production 500 responses', async ({
    error,
  }) => {
    await withProductionEnv(async () => {
      const response = await createEffectAdapterRuntimeErrorResponse(
        createApi(),
        error,
        {} as Context,
      );

      expect(response.status).toBe(500);
      expect(response.headers.get('Retry-After')).toBeNull();
      expectSafeFailureBody(
        await readJson<SafeFailureBody>(response),
        safeFailureBody(500, 'INTERNAL_SERVER_ERROR', 'Internal Server Error'),
      );
    });
  });

  test('returns a custom status from c.json(data, { status })', async () => {
    const response = await createEffectAdapterRuntimeErrorResponse(
      createApi((_error, context) =>
        (context as JsonContext).json(
          {
            handled: true,
          },
          {
            status: 409,
            headers: {
              'x-error-source': 'custom-on-error',
            },
          },
        ),
      ),
      new Error('database-password'),
      {} as Context,
    );

    expect(response.status).toBe(409);
    expect(response.headers.get('x-error-source')).toBe('custom-on-error');
    expect(await readJson(response)).toEqual({
      handled: true,
    });
  });

  test.each([
    {
      scenario: 'valid Retry-After string',
      error: Object.assign(new Error('database-password'), {
        status: 503,
        retryAfter: ' 120 ',
      }),
      expectedRetryAfter: '120',
    },
    {
      scenario: 'valid Retry-After seconds',
      error: Object.assign(new Error('database-password'), {
        status: 503,
        retryAfterSeconds: 2.1,
      }),
      expectedRetryAfter: '3',
    },
    {
      scenario: 'valid Retry-After milliseconds',
      error: Object.assign(new Error('database-password'), {
        status: 503,
        retryAfterMs: 2500,
      }),
      expectedRetryAfter: '3',
    },
    {
      scenario: 'invalid injected Retry-After string',
      error: Object.assign(new Error('database-password'), {
        status: 503,
        retryAfter: '120\r\nX-Injected: 1',
      }),
      expectedRetryAfter: null,
    },
    {
      scenario: 'invalid blank Retry-After string',
      error: Object.assign(new Error('database-password'), {
        status: 503,
        retryAfter: '   ',
      }),
      expectedRetryAfter: null,
    },
    {
      scenario: 'valid Retry-After on non-503 status',
      error: Object.assign(new Error('database-password'), {
        status: 500,
        retryAfter: '120',
      }),
      expectedRetryAfter: null,
    },
  ])('passes through Retry-After only for $scenario', async ({
    error,
    expectedRetryAfter,
  }) => {
    const response = await createEffectAdapterRuntimeErrorResponse(
      createApi(),
      error,
      {} as Context,
    );

    expect(response.headers.get('Retry-After')).toBe(expectedRetryAfter);
  });
});
