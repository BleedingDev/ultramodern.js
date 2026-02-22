import { storage } from '@modern-js/runtime-utils/node';
import nock from 'nock';
import {
  ProducerClientNotInitializedError,
  configure,
  createRequest,
  CrossOriginEnvelopePolicyError,
  IdentityBindingViolationError,
  ProducerClientNotInitializedError,
  ProducerDomainNotConfiguredError,
} from '../src/node';

describe('configure', () => {
  const url = 'http://127.0.0.1:8080';
  const path = '/api';
  const method = 'GET';
  const response = {
    code: 200,
    data: {
      message: 'hello Modernjs',
    },
  };

  // beforeEach(() => {
  //   nock.disableNetConnect();
  // });

  // afterEach(() => {
  //   nock.cleanAll();
  // });

  test('should support custom request', async () => {
    const url = 'http://127.0.0.1:9090';
    const port = 9090;

    await storage.run(
      {
        headers: {
          referer: url,
        },
        monitors: {} as any,
      },
      async () => {
        nock(url).get(path).reply(200, response);

        const customRequest = rs.fn((requestPath: any) => fetch(requestPath));

        configure({ request: customRequest as unknown as typeof fetch });
        const request = createRequest({ path, method, port });
        const res = await request();
        const data = await res.json();

        expect(customRequest).toHaveBeenCalledTimes(1);
        expect(res instanceof Response).toBe(true);
        expect(data).toStrictEqual(response);
      },
    );
  });

  test('query should support array', async () => {
    const url = 'http://127.0.0.1:9090';
    const port = 9090;

    await storage.run(
      {
        headers: {
          referer: url,
        },
        monitors: {} as any,
      },
      async () => {
        nock(url)
          .get(path)
          .query({
            users: ['foo', 'bar'],
          })
          .reply(200, response);

        const customRequest = rs.fn((requestPath: any) => fetch(requestPath));

        configure({ request: customRequest as unknown as typeof fetch });
        const request = createRequest({ path, method, port });
        const res = await request({
          query: {
            users: ['foo', 'bar'],
          },
        });
        const data = await res.json();

        expect(res instanceof Response).toBe(true);
        expect(data).toStrictEqual(response);
      },
    );
  });

  test('should support interceptor', async () => {
    await storage.run(
      {
        monitors: {} as any,
        headers: {},
      },
      async () => {
        nock(url).get(path).reply(200, response);

        const interceptor = rs.fn(
          request => (requestPath: any) => request(requestPath),
        );

        configure({ interceptor: interceptor as any });
        const request = createRequest({ path, method, port: 8080 });
        const res = await request();
        const data = await res.json();

        expect(res instanceof Response).toBe(true);
        expect(data).toStrictEqual(response);
      },
    );
  });

  test('should has correct priority', async () => {
    await storage.run(
      {
        monitors: {} as any,
        headers: {},
      },
      async () => {
        nock(url).get(path).reply(200, response);

        const customRequest = rs.fn((requestPath: any) => fetch(requestPath));

        const interceptor = rs.fn(
          request => (requestPath: any) => request(requestPath),
        );

        configure({
          request: customRequest as unknown as typeof fetch,
          interceptor: interceptor as any,
        });
        const request = createRequest({ path, method, port: 8080 });
        const res = await request();
        const data = await res.json();

        expect(interceptor).toHaveBeenCalledTimes(0);
        expect(customRequest).toHaveBeenCalledTimes(1);
        expect(res instanceof Response).toBe(true);
        expect(data).toStrictEqual(response);
      },
    );
  });

  test('should support custom headers in ssr environment', async () => {
    const authKey = 'aaa';

    await storage.run(
      {
        headers: {
          authorization: authKey,
        },
        monitors: {} as any,
      },
      async () => {
        nock(url, {
          reqheaders: {
            authorization: authKey,
          },
        })
          .get(path)
          .reply(200, response);

        configure({ allowedHeaders: ['authorization'] });
        const request = createRequest({ path, method, port: 8080 });
        const data = await request();

        expect(data).toStrictEqual(response);
      },
    );
  });

  test('should support params', async () => {
    await storage.run(
      {
        monitors: {} as any,
        headers: {},
      },
      async () => {
        nock(url).get(`${path}/modernjs`).reply(200, response);

        const interceptor = rs.fn(
          request => (requestPath: any) => request(requestPath),
        );

        configure({ interceptor: interceptor as any });

        const request = createRequest({
          path: `${path}/:id`,
          method,
          port: 8080,
        });
        const res = await request('modernjs');
        const data = await res.json();
        expect(res instanceof Response).toBe(true);
        expect(data).toStrictEqual(response);
      },
    );
  });

  test('should support params with schema', async () => {
    await storage.run(
      {
        monitors: {} as any,
        headers: {},
      },
      async () => {
        nock(url).get(`${path}/modernjs`).reply(200, response);

        const interceptor = rs.fn(
          request => (requestPath: any) => request(requestPath),
        );

        configure({ interceptor: interceptor as any });

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
      },
    );
  });

  test('should support inputParams for non-default requestId with configured domain', async () => {
    const producer = 'producer-input-params';
    const producerUrl = 'http://127.0.0.1:9091';

    await run({}, async () => {
      nock(producerUrl)
        .post(path, 'modernjs')
        .reply(200, response);

      configure({
        requestId: producer,
        setDomain: () => producerUrl,
      });

      const request = createRequest(
        path,
        'POST',
        8080,
        'inputParams',
        undefined,
        producer,
      );
      const data = await request('modernjs');
      expect(data).toStrictEqual(response);
    });
  });

  test('should throw for non-default requestId when producer client is not initialized', async () => {
    const request = createRequest(
      path,
      method,
      port: 8080,
      requestId: 'producer-app',
    });

    expect(() => request()).toThrow(ProducerClientNotInitializedError);
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
    const urlA = 'http://127.0.0.1:9081';
    const urlB = 'http://127.0.0.1:9082';

    nock(urlA).get(path).reply(200, response);
    nock(urlB).get(path).reply(200, response);

    const customRequestA = jest.fn((requestPath: any) => fetch(requestPath));
    const customRequestB = jest.fn((requestPath: any) => fetch(requestPath));

    configure({
      request: customRequestA as unknown as typeof fetch,
      requestId: producerA,
      setDomain: () => urlA,
    });
    configure({
      request: customRequestB as unknown as typeof fetch,
      requestId: producerB,
      setDomain: () => urlB,
    });

    expect(() =>
      uploader({
        files: { file: 'demo' },
      }),
    ).toThrow(ProducerClientNotInitializedError);
  });

  test('should propagate allowed headers for non-default requestId', done => {
    const producer = 'producer-non-default';
    const authKey = 'token-abc';
    const producerUrl = 'http://127.0.0.1:9083';

    run(
      {
        authorization: authKey,
      },
      async () => {
        nock(producerUrl, {
          reqheaders: {
            authorization: authKey,
          },
        })
          .get(path)
          .reply(200, response);

        configure({
          requestId: producer,
          allowedHeaders: ['authorization'],
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
        const data = await request();

        expect(data).toStrictEqual(response);
        done();
      },
    );
  });

  test('should support secure resolveHeaders callback for non-default requestId', done => {
    const producer = 'producer-with-resolver';
    const authKey = 'token-def';
    const tenant = 'tenant-a';
    const producerUrl = 'http://127.0.0.1:9084';

    run(
      {
        authorization: authKey,
        'x-tenant-id': tenant,
      },
      async () => {
        nock(producerUrl, {
          reqheaders: {
            authorization: authKey,
            'x-tenant-id': 'tenant-masked',
          },
        })
          .get(path)
          .reply(200, response);

        configure({
          requestId: producer,
          allowedHeaders: ['authorization', 'x-tenant-id'],
          resolveHeaders: ({ incomingHeaders }) => ({
            ...incomingHeaders,
            'x-tenant-id': 'tenant-masked',
            'x-injected': 'blocked',
          }),
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
        const data = await request();

        expect(data).toStrictEqual(response);
        done();
      },
    );
  });

  test('should strip client-supplied tenant headers by default for non-default producer clients', async () => {
    const producer = 'producer-identity-strip';
    const producerUrl = 'http://127.0.0.1:9085';

    await run({}, async () => {
      nock(producerUrl, {
        badheaders: ['x-tenant-id'],
      })
        .get(path)
        .reply(200, response);

      configure({
        requestId: producer,
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

      const data = await request({
        headers: {
          'x-tenant-id': 'tenant-client',
        },
      });

      expect(data).toStrictEqual(response);
    });
  });

  test('should enforce server-derived tenant and subject context over client overrides', done => {
    const producer = 'producer-identity-derived';
    const producerUrl = 'http://127.0.0.1:9086';

    run(
      {
        'x-tenant-id': 'tenant-server',
        'x-subject-id': 'subject-server',
      },
      async () => {
        nock(producerUrl, {
          reqheaders: {
            'x-tenant-id': 'tenant-server',
            'x-subject-id': 'subject-server',
          },
        })
          .get(path)
          .reply(200, response);

        configure({
          requestId: producer,
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

        const data = await request({
          headers: {
            'x-tenant-id': 'tenant-client',
            'x-subject-id': 'subject-client',
          },
        });

        expect(data).toStrictEqual(response);
        done();
      },
    );
  });

  test('should reject client identity override in strict identity binding mode', () => {
    const producer = 'producer-identity-strict';

    configure({
      requestId: producer,
      setDomain: () => 'http://127.0.0.1:9087',
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

    expect(() =>
      request({
        headers: {
          'x-tenant-id': 'tenant-client',
        },
      }),
    ).toThrow(IdentityBindingViolationError);
  });

  test('should require envelope and block cross-origin producer calls in production by default', done => {
    const producer = 'producer-envelope-default';
    const previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    run(
      {
        origin: 'https://consumer.internal',
      },
      async () => {
        try {
          configure({
            requestId: producer,
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

          expect(() => request()).toThrow(CrossOriginEnvelopePolicyError);
        } finally {
          process.env.NODE_ENV = previousEnv;
        }
        done();
      },
    );
  });

  test('should allow explicit cross-origin envelope policy and attach envelope header', done => {
    const producer = 'producer-envelope-policy';
    const producerUrl = 'https://producer.internal';
    const previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    run(
      {
        origin: 'https://consumer.internal',
      },
      async () => {
        try {
          nock(producerUrl).get(path).reply(200, response);
          const customRequest = jest.fn((requestPath: any, init: any) =>
            fetch(requestPath, init),
          );

          configure({
            request: customRequest as unknown as typeof fetch,
            requestId: producer,
            setDomain: () => producerUrl,
            allowCrossOriginEnvelope: ({
              requestId,
              sourceOrigin,
              targetOrigin,
            }) =>
              requestId === producer &&
              sourceOrigin === 'https://consumer.internal' &&
              targetOrigin === producerUrl,
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
          const data = await res.json();

          const headers = customRequest.mock.calls[0][1].headers;
          const envelope = JSON.parse(headers['x-modernjs-bff-envelope']);
          expect(envelope.requestId).toBe(producer);
          expect(envelope.target).toBe('server');
          expect(data).toStrictEqual(response);
        } finally {
          process.env.NODE_ENV = previousEnv;
        }
        done();
      },
    );
  });

  test('should attach operation context headers for non-default producer client', done => {
    const producer = 'crm.producer-a';
    const producerUrl = 'http://127.0.0.1:18080';
    const traceparent =
      '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

    run({ traceparent }, async () => {
      nock(producerUrl).get(path).reply(200, response);
      const customRequest = jest.fn((requestPath: any, init: any) =>
        fetch(requestPath, init),
      );

      configure({
        request: customRequest as unknown as typeof fetch,
        requestId: producer,
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
      await request();

      const headers = customRequest.mock.calls[0][1].headers;
      expect(headers['x-operation-id']).toBe(`${producer}:GET:${path}`);
      expect(headers.traceparent).toBe(traceparent);
      const operationContext = JSON.parse(
        headers['x-modernjs-bff-operation-context'],
      );
      expect(operationContext.requestId).toBe(producer);
      expect(operationContext.operationId).toBe(`${producer}:GET:${path}`);
      expect(operationContext.traceparent).toBe(traceparent);
      expect(operationContext.traceId).toBe(
        '4bf92f3577b34da6a3ce929d0e0e4736',
      );
      expect(operationContext.spanId).toBe('00f067aa0ba902b7');
      done();
    });
  });

  test('should retry with backoff and emit degraded telemetry events', async () => {
    jest.useFakeTimers();
    const onDegraded = jest.fn();
    let attempts = 0;

    const customRequest = jest.fn(async () => {
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
        request: customRequest as unknown as typeof fetch,
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

      const request = createRequest(path, method, 8080);
      const pending = request();

      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(20);
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(20);
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
      jest.useRealTimers();
    }
  });

  test('should emit retry_exhausted when retry budget is consumed', async () => {
    jest.useFakeTimers();
    const onDegraded = jest.fn();
    const customRequest = jest.fn(async () => {
      const error: any = new Error('upstream unavailable');
      error.status = 503;
      throw error;
    });

    try {
      configure({
        request: customRequest as unknown as typeof fetch,
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

      const request = createRequest(path, method, 8080);
      const pending = request();
      const failure = expect(pending).rejects.toThrow('upstream unavailable');

      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(10);
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
      jest.useRealTimers();
    }
  });

  test('should abort timed out requests and emit timeout degraded event', async () => {
    jest.useFakeTimers();
    const onDegraded = jest.fn();

    const customRequest = jest.fn((_requestPath: any, init?: any) => {
      return new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error: any = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    });

    try {
      configure({
        request: customRequest as unknown as typeof fetch,
        transport: {
          timeoutMs: 50,
          onDegraded,
        },
      });

      const request = createRequest(path, method, 8080);
      const pending = request();
      const failure = expect(pending).rejects.toMatchObject({
        name: 'TimeoutError',
      });

      await jest.advanceTimersByTimeAsync(50);
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
      jest.useRealTimers();
    }
  });
});
