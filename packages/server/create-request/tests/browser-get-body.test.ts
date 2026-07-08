import { configure, createRequest } from '../src/browser';

describe('browser createRequest GET body policy', () => {
  test('strips GET request bodies before configured browser transport', async () => {
    const response = {
      code: 200,
      data: {
        message: 'ok',
      },
    };
    const customRequest = rs.fn(
      async (_requestPath: RequestInfo, init?: RequestInit) =>
        new Response(JSON.stringify(response), { status: 200 }),
    );

    configure({ request: customRequest });
    const request = createRequest({
      path: '/api',
      method: 'GET',
      port: 8080,
    });

    const res = await request({ body: 'ignored' });
    const data = await res.json();

    expect(data).toStrictEqual(response);
    expect(customRequest).toHaveBeenCalledTimes(1);
    expect(customRequest.mock.calls[0][1]?.body).toBeUndefined();
  });
});
