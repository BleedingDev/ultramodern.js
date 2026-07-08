import { configure, createRequest } from '../src/browser';

describe('accept header defaults', () => {
  test('should replace case-variant accept payload header instead of sending duplicate keys', async () => {
    const customRequest = rs.fn(
      (_requestPath: RequestInfo, init?: RequestInit) =>
        Promise.resolve(new Response(JSON.stringify({ ok: true }))),
    );

    configure({ request: customRequest });
    const request = createRequest({
      path: '/api',
      method: 'GET',
      port: 8080,
    });

    await request({
      headers: {
        Accept: 'application/problem+json',
      },
    });

    const headers = customRequest.mock.calls[0]?.[1]?.headers as Record<
      string,
      string
    >;

    expect(headers.Accept).toBeUndefined();
    expect(headers.accept).toBe('application/json,*/*;q=0.8');
    expect(
      Object.keys(headers).filter(key => key.toLowerCase() === 'accept'),
    ).toEqual(['accept']);
  });
});
