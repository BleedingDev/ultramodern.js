// @rstest-environment happy-dom

import {
  createErrorHtml,
  createSafeFailureHttpResult,
  createSafeJsonFailureResponse,
} from '../../src/utils';

describe('test utils.error', () => {
  it.each([
    {
      status: 404,
      title: '404: This page could not be found.',
      message: 'This page could not be found.',
    },
    {
      status: 500,
      title: '500: Internal Server Error.',
      message: 'Internal Server Error.',
    },
  ])('should create an accessible, viewport-centered $status error document', ({
    status,
    title,
    message,
  }) => {
    const errorDocument = new DOMParser().parseFromString(
      createErrorHtml(status),
      'text/html',
    );

    expect(errorDocument.documentElement.lang).toBe('en');
    expect(errorDocument.characterSet).toBe('utf-8');
    expect(
      errorDocument
        .querySelector('meta[name="viewport"]')
        ?.getAttribute('content'),
    ).toBe('width=device-width');
    expect(errorDocument.title).toBe(title);

    expect(errorDocument.body.children).toHaveLength(1);
    const page = errorDocument.body.firstElementChild;
    expect(page).not.toBeNull();
    expect(page?.children).toHaveLength(2);

    const headings = errorDocument.querySelectorAll('h1');
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe(String(status));
    expect(headings[0].nextElementSibling?.textContent).toBe(message);

    const style = page
      ? errorDocument.defaultView?.getComputedStyle(page)
      : undefined;
    expect(style).toMatchObject({
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
    });
    expect(style?.height).toBe(`${errorDocument.defaultView?.innerHeight}px`);
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
