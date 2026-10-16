import { once } from 'node:events';
import { createServer } from 'node:http';
import { configure, createRequest } from '../src/browser';

describe('configure', () => {
  let url: string;
  const server = createServer((_request, result) => {
    result.writeHead(200, { 'Content-Type': 'application/json' });
    result.end(JSON.stringify(response));
  });

  beforeAll(async () => {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing server port');
    url = `http://127.0.0.1:${address.port}`;
    window.happyDOM.setURL(url);
  });

  afterAll(async () => {
    server.close();
    await once(server, 'close');
  });
  const path = '/api';
  const method = 'GET';
  const response = {
    code: 200,
    data: {
      message: 'hello Modernjs',
    },
  };

  test('should support custom request', async () => {
    const customRequest = rs.fn((requestPath: RequestInfo) => {
      const finalUrl = `${url}${requestPath as string}`;
      return fetch(finalUrl);
    });

    configure({ request: customRequest });
    const request = createRequest({
      path,
      method,
      port: 8080,
    });
    const res = await request();
    const data = await res.json();

    expect(customRequest).toHaveBeenCalledTimes(1);
    expect(res instanceof Response).toBe(true);
    expect(data).toStrictEqual(response);
  });

  test('query should support array', async () => {
    const customRequest = rs.fn((requestPath: RequestInfo) => {
      const finalUrl = `${url}${requestPath as string}`;
      return fetch(finalUrl);
    });

    configure({ request: customRequest });
    const request = createRequest({
      path,
      method,
      port: 8080,
    });
    const res = await request({
      query: {
        users: ['foo', 'bar'],
      },
    });
    const data = await res.json();

    expect(res instanceof Response).toBe(true);
    expect(data).toStrictEqual(response);
  });

  test('should support interceptor', async () => {
    const interceptor = rs.fn(request => (requestPath: RequestInfo) => {
      const finalUrl = `${url}${requestPath as string}`;
      return request(finalUrl);
    });

    configure({ interceptor });
    const request = createRequest({
      path,
      method,
      port: 8080,
    });
    const res = await request();
    const data = await res.json();

    expect(res instanceof Response).toBe(true);
    expect(data).toStrictEqual(response);
  });

  test('should has correct order', async () => {
    const customRequest = rs.fn((requestPath: RequestInfo) => {
      const finalUrl = `${url}${requestPath as string}`;
      return fetch(finalUrl);
    });

    const interceptor = rs.fn(request => (requestPath: RequestInfo) => {
      const finalUrl = `${url}${requestPath as string}`;
      return request(finalUrl);
    });

    configure({ request: customRequest, interceptor });
    const request = createRequest({
      path,
      method,
      port: 8080,
    });
    const res = await request();
    const data = await res.json();

    expect(interceptor).toHaveBeenCalledTimes(0);
    expect(customRequest).toHaveBeenCalledTimes(1);
    expect(res instanceof Response).toBe(true);
    expect(data).toStrictEqual(response);
  });

  test('should support params', async () => {
    const interceptor = rs.fn(request => (requestPath: RequestInfo) => {
      const finalUrl = `${url}${requestPath as string}`;
      return request(finalUrl);
    });

    configure({ interceptor });
    const request = createRequest({
      path: `${path}/:id`,
      method,
      port: 8080,
    });
    const res = await request('modernjs');
    const data = await res.json();
    expect(res instanceof Response).toBe(true);
    expect(data).toStrictEqual(response);
  });

  test('should support params with schema', async () => {
    const interceptor = rs.fn(request => (requestPath: RequestInfo) => {
      const finalUrl = `${url}${requestPath as string}`;
      return request(finalUrl);
    });

    configure({ interceptor });

    const request = createRequest({
      path: `${path}/:id`,
      method,
      port: 8080,
    });
    const res = await request({
      params: {
        id: 'modernjs',
      },
    });
    const data = await res.json();
    expect(res instanceof Response).toBe(true);
    expect(data).toStrictEqual(response);
  });

  describe('options.domain', () => {
    const domain = 'https://bff.example.com';
    const okResponse = () =>
      Promise.resolve(new Response(JSON.stringify(response)));

    const deciders = ['functionName', 'inputParams'] as const;

    test.each(deciders)(
      'should prefix the resolved url with options.domain (%s decider)',
      async httpMethodDecider => {
        const customRequest = rs.fn((_requestPath: RequestInfo) =>
          okResponse(),
        );
        configure({ request: customRequest });

        const request = createRequest({
          path,
          method,
          port: 8080,
          httpMethodDecider,
          domain,
        });
        await request();

        expect(customRequest).toHaveBeenCalledTimes(1);
        expect(customRequest.mock.calls[0][0]).toBe(`${domain}${path}`);
      },
    );

    test('should resolve a relative url when no domain is supplied', async () => {
      const customRequest = rs.fn((_requestPath: RequestInfo) => okResponse());
      configure({ request: customRequest });

      const request = createRequest({
        path,
        method,
        port: 8080,
      });
      await request();

      expect(customRequest.mock.calls[0][0]).toBe(path);
    });

    test('should let a configured setDomain override options.domain', async () => {
      const producer = 'producer-browser-domain-precedence';
      const configuredDomain = 'https://configured.example.com';
      const customRequest = rs.fn((_requestPath: RequestInfo) => okResponse());

      configure({
        request: customRequest,
        requestId: producer,
        setDomain: () => configuredDomain,
      });

      const request = createRequest({
        path,
        method,
        port: 8080,
        domain,
        requestId: producer,
      });
      await request();

      expect(customRequest.mock.calls[0][0]).toBe(`${configuredDomain}${path}`);
    });
  });
});
