import {
  configure,
  createRequest,
} from '@modern-js/runtime-extensions/request-policy/client';

describe('configure', () => {
  const path = '/api';
  const method = 'GET';
  const response = {
    code: 200,
    data: {
      message: 'hello Modernjs',
    },
  };

  test('should allow explicit cross-origin policy and attach envelope header', async () => {
    const producer = 'producer-browser-policy';
    const producerUrl = 'https://producer.internal';
    const previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      const customRequest = rs.fn(
        (_requestPath: RequestInfo, _init?: RequestInit) =>
          Promise.resolve(new Response(JSON.stringify(response))),
      );

      configure({
        request: customRequest,
        requestId: producer,
        operationContract: {
          enabled: false,
        },
        setDomain: () => producerUrl,
        allowCrossOriginEnvelope: true,
      });

      const request = createRequest(
        path,
        method,
        8080,
        undefined,
        undefined,
        producer,
      );
      const res = await request();
      expect(customRequest.mock.calls[0][0]).toBe(`${producerUrl}${path}`);

      const headers = customRequest.mock.calls[0][1].headers as Record<
        string,
        string
      >;
      const envelope = JSON.parse(headers['x-modernjs-bff-envelope']);
      expect(envelope.requestId).toBe(producer);
      expect(envelope.target).toBe('browser');
      expect(res instanceof Response).toBe(true);
      await expect(res.json()).resolves.toEqual(response);
    } finally {
      process.env.NODE_ENV = previousEnv;
    }
  });

  test('should not require process to exist in browser runtime', async () => {
    const previousProcess = globalThis.process;
    const customRequest = rs.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            code: 200,
            data: {
              message: 'ok',
            },
          }),
        ),
      ),
    );

    try {
      Object.defineProperty(globalThis, 'process', {
        configurable: true,
        value: undefined,
      });
      configure({
        request: customRequest,
      });

      const request = createRequest({
        path,
        method,
        port: 8080,
      });
      const response = await request();
      const data = await response.json();

      expect(data).toStrictEqual({
        code: 200,
        data: {
          message: 'ok',
        },
      });
    } finally {
      Object.defineProperty(globalThis, 'process', {
        configurable: true,
        value: previousProcess,
      });
    }
  });
});
