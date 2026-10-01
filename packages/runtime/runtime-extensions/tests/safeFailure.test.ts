import {
  createSafeFailureHttpResult,
  createSafeFailureResponse,
  createSafeJsonFailureResponse,
  getSafeFailureStatus,
} from '../src/safeFailure';

const readBody = async (response: Response) =>
  (await response.json()) as Record<string, unknown>;

describe('safe failure responses', () => {
  it.each([[500, 'INTERNAL_SERVER_ERROR', 'Internal Server Error']])(
    'redacts a %i failure through every response surface',
    async (status, code, message) => {
      const error = Object.assign(new Error('database-password'), {
        status,
        code: 'SECRET_CODE',
        cause: 'root-cause',
        details: 'internal-details',
        stack: 'hidden-stack',
      });
      const expectedBody = {
        success: false,
        error: { code, message, status },
      };

      expect(createSafeFailureHttpResult(error)).toMatchObject({
        status,
        body: expectedBody,
      });
      for (const createResponse of [
        createSafeFailureResponse,
        createSafeJsonFailureResponse,
      ]) {
        const response = createResponse(error);
        expect(response.status).toBe(status);
        expect(response.headers.get('content-type')).toBe(
          'application/json; charset=utf-8',
        );
        const body = await readBody(response);
        expect(body).toEqual(expectedBody);
        expect(JSON.stringify(body)).not.toMatch(
          /database-password|SECRET_CODE|root-cause|internal-details|hidden-stack/u,
        );
      }

      // Response construction must not destroy the raw error retained for
      // internal structured diagnostics.
      expect(error.cause).toBe('root-cause');
      expect(error.details).toBe('internal-details');
    },
  );

  it.each([
    ['delay seconds text', ' 120 ', '120'],
    [
      'valid Date object',
      new Date(Date.UTC(2026, 7, 30, 20, 0, 0)),
      'Sun, 30 Aug 2026 20:00:00 GMT',
    ],
  ])('canonicalizes %s for Retry-After', (_, retryAfter, expected) => {
    const result = createSafeFailureHttpResult({ status: 503, retryAfter });
    expect(result.headers['Retry-After']).toBe(expected);
  });

  it('derives Retry-After from a retryAfterSeconds error property', () => {
    const error = Object.assign(new Error('maintenance'), {
      status: 503,
      retryAfterSeconds: 120,
    });
    expect(createSafeFailureHttpResult(error).headers['Retry-After']).toBe(
      '120',
    );
  });

  it('converts Retry-After milliseconds to canonical delay seconds', () => {
    expect(
      createSafeFailureHttpResult({ status: 503, retryAfterMs: 2500 }).headers[
        'Retry-After'
      ],
    ).toBe('3');
  });

  it.each([
    ['a header injection payload', '120\r\nX-Injected: true'],
    ['an invalid Date object', new Date(Number.NaN)],
  ])('rejects %s as Retry-After', (_, retryAfter) => {
    const result = createSafeFailureHttpResult({ status: 503, retryAfter });
    expect(result.headers['Retry-After']).toBeUndefined();
    expect(() =>
      createSafeFailureResponse({ status: 503, retryAfter }),
    ).not.toThrow();
  });

  it('never emits Retry-After for a non-503 response', () => {
    expect(
      createSafeFailureHttpResult({ status: 500, retryAfter: '120' }).headers[
        'Retry-After'
      ],
    ).toBeUndefined();
  });

  it('fails closed without throwing when error property access is hostile', () => {
    const hostile = new Proxy(
      {},
      {
        has() {
          throw new Error('proxy trap secret');
        },
        get() {
          throw new Error('getter secret');
        },
      },
    );

    expect(getSafeFailureStatus(hostile)).toBe(500);
    expect(createSafeFailureHttpResult(hostile)).toEqual({
      status: 500,
      body: {
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Internal Server Error',
          status: 500,
        },
      },
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
    });
  });

  it('uses statusCode only when it is a valid failure status', () => {
    expect(getSafeFailureStatus({ status: 200, statusCode: 503 })).toBe(503);
    expect(getSafeFailureStatus({ status: 503.5, statusCode: 799 })).toBe(500);
  });
});
