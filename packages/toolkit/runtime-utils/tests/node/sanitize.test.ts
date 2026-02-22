import { sanitizeSSRPayload } from '../../src/node/sanitize';

describe('sanitizeSSRPayload', () => {
  it('should remove unsafe headers under headers containers', () => {
    const result = sanitizeSSRPayload({
      context: {
        request: {
          headers: {
            authorization: 'Bearer secret',
            cookie: 'sid=abc',
            'x-request-id': 'req-1',
          },
        },
      },
      data: {
        nestedHeaders: {
          'set-cookie': 'token=abc',
          'x-tenant-id': 't-1',
        },
      },
    });

    expect(result.payload).toEqual({
      context: {
        request: {
          headers: {
            'x-request-id': 'req-1',
          },
        },
      },
      data: {
        nestedHeaders: {
          'x-tenant-id': 't-1',
        },
      },
    });
    expect(result.removed).toEqual([
      'context.request.headers.authorization',
      'context.request.headers.cookie',
      'data.nestedHeaders.set-cookie',
    ]);
  });

  it('should allow custom unsafe header keys', () => {
    const result = sanitizeSSRPayload(
      {
        headers: {
          'x-internal-secret': 'hidden',
          'x-request-id': 'req-2',
        },
      },
      { unsafeHeaders: ['x-internal-secret'] },
    );

    expect(result.payload).toEqual({
      headers: {
        'x-request-id': 'req-2',
      },
    });
    expect(result.removed).toEqual(['headers.x-internal-secret']);
  });

  it('should sanitize root payload when treatRootAsHeaders is enabled', () => {
    const result = sanitizeSSRPayload(
      {
        authorization: 'Bearer secret',
        'x-request-id': 'req-3',
      },
      { treatRootAsHeaders: true },
    );

    expect(result.payload).toEqual({
      'x-request-id': 'req-3',
    });
    expect(result.removed).toEqual(['authorization']);
  });
});
