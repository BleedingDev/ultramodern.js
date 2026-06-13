import {
  createErrorHtml,
  createSafeFailureHttpResult,
  createSafeJsonFailureResponse,
} from '../../src/utils';

describe('test utils.error', () => {
  it('should get 404 error html', () => {
    const html = createErrorHtml(404);

    expect(html).toMatchSnapshot();
  });

  it('should get 500 error html', () => {
    const html = createErrorHtml(500);

    expect(html).toMatchSnapshot();
  });

  it('should create safe JSON failure envelopes without leaking raw messages', async () => {
    const result = createSafeFailureHttpResult(
      new Error('database password leaked in stack'),
    );

    expect(result).toEqual({
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

    const response = createSafeJsonFailureResponse(
      new Error('database password leaked in stack'),
    );
    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toEqual(result.body);
  });

  it('should preserve service unavailable status and Retry-After metadata', () => {
    const error = Object.assign(new Error('maintenance window details'), {
      status: 503,
      retryAfterSeconds: 120,
    });

    expect(createSafeFailureHttpResult(error)).toEqual({
      status: 503,
      body: {
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Service Unavailable',
          status: 503,
        },
      },
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'Retry-After': '120',
      },
    });
  });

  it('should clamp invalid thrown status values to 500', () => {
    expect(createSafeFailureHttpResult({ status: 200 }).status).toBe(500);
    expect(createSafeFailureHttpResult({ statusCode: 799 }).status).toBe(500);
  });
});
