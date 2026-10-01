import nock from 'nock';
import { configure, createRequest } from '../src/browser';

describe('configure', () => {
  const url = 'http://localhost:8080';
  const path = '/api';
  const method = 'GET';
  const response = {
    code: 200,
    data: {
      message: 'hello Modernjs',
    },
  };

  // TODO: 如果 disableNetConnect 之后，会影响到其他的 testcase 偶发性的出现 NetConnectNotAllowedError: Nock: Disallowed net connect for "127.0.0.1:49552/" 的错误
  // beforeEach(() => {
  //   nock.disableNetConnect();
  // });

  // afterEach(() => {
  //   nock.cleanAll();
  // });

  test('should support custom request', async () => {
    nock(url).get(path).reply(200, response);

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
    nock(url)
      .get(path)
      .query({
        users: ['foo', 'bar'],
      })
      .reply(200, response);

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
    nock(url).get(path).reply(200, response);

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
    nock(url).get(path).reply(200, response);

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
    nock(url).get(`${path}/modernjs`).reply(200, response);

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
    nock(url).get(`${path}/modernjs`).reply(200, response);

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
