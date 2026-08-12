import nock from 'nock';
import {
  CrossOriginEnvelopePolicyError,
  configure,
  createRequest,
  IdentityBindingViolationError,
  OperationContractViolationError,
  ProducerClientNotInitializedError,
  ProducerDomainNotConfiguredError,
} from '../src/browser';

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

  test('should throw when non-default requestId is used before bootstrap', async () => {
    const request = createRequest({
      path,
      method,
      port: 8080,
      requestId: 'producer-app',
    });

    await expect(request()).rejects.toBeInstanceOf(
      ProducerClientNotInitializedError,
    );
  });

  test('should require setDomain when configuring non-default requestId', () => {
    expect(() =>
      configure({
        requestId: 'producer-a',
      }),
    ).toThrow(ProducerDomainNotConfiguredError);
  });

  test('should isolate custom request by requestId', async () => {
    const producerA = 'producer-a';
    const producerB = 'producer-b';
    const urlA = 'http://localhost:9081';
    const urlB = 'http://localhost:9082';

    nock(urlA).get(path).reply(200, response);
    nock(urlB).get(path).reply(200, response);

    const customRequestA = rs.fn((requestPath: RequestInfo) =>
      fetch(requestPath as string),
    );

    const customRequestB = rs.fn((requestPath: RequestInfo) =>
      fetch(requestPath as string),
    );

    configure({
      request: customRequestA,
      requestId: producerA,
      operationContract: {
        enabled: false,
      },
      allowCrossOriginEnvelope: true,
      setDomain: () => urlA,
    });
    configure({
      request: customRequestB,
      requestId: producerB,
      operationContract: {
        enabled: false,
      },
      allowCrossOriginEnvelope: true,
      setDomain: () => urlB,
    });

    const requestA = createRequest(
      path,
      method,
      8080,
      undefined,
      undefined,
      producerA,
    );
    const requestB = createRequest(
      path,
      method,
      8080,
      undefined,
      undefined,
      producerB,
    );

    const resA = await requestA();
    const resB = await requestB();

    expect(customRequestA).toHaveBeenCalledTimes(1);
    expect(customRequestB).toHaveBeenCalledTimes(1);
    expect(resA instanceof Response).toBe(true);
    expect(resB instanceof Response).toBe(true);
  });

  test('should reject client identity headers by default for non-default producer clients', async () => {
    const producer = 'producer-browser-identity-strip';
    const producerUrl = 'http://localhost:9083';

    nock(producerUrl).get(path).reply(200, response);
    const customRequest = rs.fn(
      (requestPath: RequestInfo, init?: RequestInit) =>
        fetch(requestPath, init),
    );

    configure({
      request: customRequest,
      requestId: producer,
      operationContract: {
        enabled: false,
      },
      setDomain: () => producerUrl,
    });

    const request = createRequest(
      path,
      method,
      8080,
      undefined,
      undefined,
      producer,
    );
    await expect(
      request({
        headers: {
          'x-tenant-id': 'tenant-client',
        },
      }),
    ).rejects.toBeInstanceOf(IdentityBindingViolationError);
  });

  test('should support derived identity binding headers when explicitly configured', async () => {
    const producer = 'producer-browser-identity-derived';
    const producerUrl = 'http://localhost:9084';

    nock(producerUrl).get(path).reply(200, response);
    const customRequest = rs.fn(
      (requestPath: RequestInfo, init?: RequestInit) =>
        fetch(requestPath, init),
    );

    configure({
      request: customRequest,
      requestId: producer,
      operationContract: {
        enabled: false,
      },
      allowCrossOriginEnvelope: true,
      setDomain: () => producerUrl,
      identityBinding: {
        strict: false,
        deriveHeaders: () => ({
          'x-tenant-id': 'tenant-derived',
        }),
      },
    });

    const request = createRequest(
      path,
      method,
      8080,
      undefined,
      undefined,
      producer,
    );
    await request();

    const sentHeaders = customRequest.mock.calls[0][1].headers as Record<
      string,
      string
    >;
    expect(sentHeaders['x-tenant-id']).toBe('tenant-derived');
  });

  test('should reject client identity override in strict identity binding mode', async () => {
    const producer = 'producer-browser-identity-strict';
    configure({
      requestId: producer,
      setDomain: () => 'http://localhost:9085',
      operationContract: {
        enabled: false,
      },
      identityBinding: {
        strict: true,
      },
    });

    const request = createRequest(
      path,
      method,
      8080,
      undefined,
      undefined,
      producer,
    );

    await expect(
      request({
        headers: {
          'x-subject-id': 'subject-client',
        },
      }),
    ).rejects.toBeInstanceOf(IdentityBindingViolationError);
  });

  test('should require envelope and block cross-origin producer calls in production by default', async () => {
    const producer = 'producer-browser-envelope';
    const previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      configure({
        requestId: producer,
        operationContract: {
          enabled: false,
        },
        setDomain: () => 'https://producer.internal',
      });
      const request = createRequest(
        path,
        method,
        8080,
        undefined,
        undefined,
        producer,
      );

      await expect(request()).rejects.toBeInstanceOf(
        CrossOriginEnvelopePolicyError,
      );
    } finally {
      process.env.NODE_ENV = previousEnv;
    }
  });

  test('should allow explicit cross-origin policy and attach envelope header', async () => {
    const producer = 'producer-browser-policy';
    const producerUrl = 'https://producer.internal';
    const previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      nock(producerUrl).get(path).reply(200, response);
      const customRequest = rs.fn(
        (requestPath: RequestInfo, init?: RequestInit) =>
          fetch(requestPath, init),
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

      const headers = customRequest.mock.calls[0][1].headers as Record<
        string,
        string
      >;
      const envelope = JSON.parse(headers['x-modernjs-bff-envelope']);
      expect(envelope.requestId).toBe(producer);
      expect(envelope.target).toBe('browser');
      expect(res instanceof Response).toBe(true);
    } finally {
      process.env.NODE_ENV = previousEnv;
    }
  });

  test('should attach operation context headers for non-default producer client', async () => {
    const producer = 'crm.producer-a';
    const producerUrl = 'http://localhost:18080';
    const traceparent =
      '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    nock(producerUrl).get(path).reply(200, response);

    const customRequest = rs.fn(
      (requestPath: RequestInfo, init?: RequestInit) =>
        fetch(requestPath, init),
    );

    configure({
      request: customRequest,
      requestId: producer,
      allowCrossOriginEnvelope: true,
      setDomain: () => producerUrl,
    });

    const request = createRequest(
      path,
      method,
      8080,
      undefined,
      undefined,
      producer,
      {
        traceparent,
        operationId: `GET:${path}`,
        routePath: path,
        method,
        schemaHash: 'schema-test',
        operationVersion: 1,
      },
    );
    await request();

    const headers = customRequest.mock.calls[0][1].headers as Record<
      string,
      string
    >;
    expect(headers['x-operation-id']).toBe(`${producer}:GET:${path}`);
    expect(headers.traceparent).toBe(traceparent);
    const operationContext = JSON.parse(
      headers['x-modernjs-bff-operation-context'],
    );
    expect(operationContext.requestId).toBe(producer);
    expect(operationContext.operationId).toBe(`${producer}:GET:${path}`);
    expect(operationContext.traceparent).toBe(traceparent);
    expect(operationContext.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(operationContext.spanId).toBe('00f067aa0ba902b7');
  });

  test('should reject requests missing schema/version operation contract metadata by default', async () => {
    const producer = 'producer-browser-operation-contract-default';
    configure({
      requestId: producer,
      allowCrossOriginEnvelope: true,
      setDomain: () => 'http://localhost:9086',
    });

    const request = createRequest(
      path,
      method,
      8080,
      undefined,
      undefined,
      producer,
    );

    await expect(request()).rejects.toBeInstanceOf(
      OperationContractViolationError,
    );
  });

  test('should enforce operation contract metadata for default requestId when strict-default mode is enabled', async () => {
    process.env.MODERN_BFF_STRICT_DEFAULT_REQUEST_ID = 'true';
    try {
      configure({
        operationContract: {
          enabled: true,
          strict: true,
          requireSchemaHash: true,
          requireOperationVersion: true,
        },
      });

      const request = createRequest(path, method, 8080, undefined);
      await expect(request()).rejects.toBeInstanceOf(
        OperationContractViolationError,
      );
    } finally {
      configure({
        operationContract: {
          enabled: false,
        },
      });
      delete process.env.MODERN_BFF_STRICT_DEFAULT_REQUEST_ID;
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

  describe('options.domain', () => {
    const domain = 'https://bff.example.com';
    const okResponse = () =>
      Promise.resolve(new Response(JSON.stringify(response)));

    const deciders = ['functionName', 'inputParams'] as const;

    test.each(
      deciders,
    )('should prefix the resolved url with options.domain (%s decider)', async httpMethodDecider => {
      const customRequest = rs.fn((_requestPath: RequestInfo) => okResponse());
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
    });

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
        allowCrossOriginEnvelope: true,
        operationContract: {
          enabled: false,
        },
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

  test('should retry with backoff and emit degraded telemetry events', async () => {
    rs.useFakeTimers();
    const onDegraded = rs.fn();
    let attempts = 0;

    const customRequest = rs.fn(async () => {
      attempts += 1;
      if (attempts < 3) {
        const error: any = new Error('temporary upstream error');
        error.status = 503;
        throw error;
      }

      return response;
    });

    try {
      configure({
        request: customRequest,
        transport: {
          retry: {
            retries: 2,
            baseDelayMs: 20,
            maxDelayMs: 20,
            jitterRatio: 0,
          },
          onDegraded,
        },
      });

      const request = createRequest(path, method, 8080, undefined);
      const pending = request();

      await Promise.resolve();
      await rs.advanceTimersByTimeAsync(20);
      await Promise.resolve();
      await rs.advanceTimersByTimeAsync(20);
      await Promise.resolve();

      await expect(pending).resolves.toStrictEqual(response);
      expect(customRequest).toHaveBeenCalledTimes(3);
      expect(onDegraded).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'retry',
          attempt: 1,
          maxAttempts: 3,
          backoffMs: 20,
        }),
      );
      expect(onDegraded).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'retry',
          attempt: 2,
          maxAttempts: 3,
          backoffMs: 20,
        }),
      );
    } finally {
      rs.useRealTimers();
    }
  });

  test('should emit retry_exhausted when retry budget is consumed', async () => {
    rs.useFakeTimers();
    const onDegraded = rs.fn();
    const customRequest = rs.fn(async () => {
      const error: any = new Error('upstream unavailable');
      error.status = 503;
      throw error;
    });

    try {
      configure({
        request: customRequest,
        transport: {
          retry: {
            retries: 1,
            baseDelayMs: 10,
            maxDelayMs: 10,
            jitterRatio: 0,
          },
          onDegraded,
        },
      });

      const request = createRequest(path, method, 8080, undefined);
      const pending = request();
      const failure = expect(pending).rejects.toThrow('upstream unavailable');

      await Promise.resolve();
      await rs.advanceTimersByTimeAsync(10);
      await failure;

      expect(customRequest).toHaveBeenCalledTimes(2);
      expect(onDegraded).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'retry',
          attempt: 1,
          maxAttempts: 2,
        }),
      );
      expect(onDegraded).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'retry_exhausted',
          attempt: 2,
          maxAttempts: 2,
        }),
      );
    } finally {
      rs.useRealTimers();
    }
  });

  test('should abort timed out requests and emit timeout degraded event', async () => {
    rs.useFakeTimers();
    const onDegraded = rs.fn();

    const customRequest = rs.fn(
      (_requestPath: RequestInfo, init?: RequestInit) => {
        return new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error: any = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
      },
    );

    try {
      configure({
        request: customRequest,
        transport: {
          timeoutMs: 50,
          onDegraded,
        },
      });

      const request = createRequest(path, method, 8080, undefined);
      const pending = request();
      const failure = expect(pending).rejects.toMatchObject({
        name: 'TimeoutError',
      });

      await rs.advanceTimersByTimeAsync(50);
      await failure;

      expect(customRequest).toHaveBeenCalledTimes(1);
      expect(onDegraded).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'timeout',
          timeoutMs: 50,
          attempt: 1,
          maxAttempts: 1,
        }),
      );
    } finally {
      rs.useRealTimers();
    }
  });
});
