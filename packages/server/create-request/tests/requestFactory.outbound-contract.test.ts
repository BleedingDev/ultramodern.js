import { createRequestFactory } from '../src/requestFactory';
import {
  BFF_ENVELOPE_HEADER,
  BFF_OPERATION_CONTEXT_DETAIL_HEADER,
  BFF_OPERATION_CONTEXT_HEADER,
  type IdentityBindingOptions,
  type OperationContext,
  type OperationContractOptions,
  type TransportTarget,
} from '../src/types';

const ACCEPT_HEADER = 'application/json,*/*;q=0.8';
const REQUEST_PATH = '/api/widgets';
const PORT = 8080;
const SERVER_URL = `http://127.0.0.1:${PORT}${REQUEST_PATH}`;
const PRODUCER_URL = `https://producer.example${REQUEST_PATH}`;
const CONSUMER_ORIGIN = 'https://consumer.example';
const INCOMING_TRACEPARENT =
  '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
const OPERATION_TRACEPARENT =
  '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01';

type HeaderMap = Record<string, any>;
type Method = 'GET' | 'POST';

type OutboundScenario = {
  name: string;
  target: TransportTarget;
  method: Method;
  requestId?: string;
  domain?: string;
  incomingHeaders?: HeaderMap;
  payload: {
    body?: string;
    headers?: HeaderMap;
  };
  identityBinding?: IdentityBindingOptions;
  requireEnvelope?: boolean;
  allowCrossOriginEnvelope?: boolean;
  operationContract?: OperationContractOptions;
  operationContext?: OperationContext;
  expectedUrl: string;
  expectedBody?: string;
  expectedHeaderKeys: string[];
  expectedStaticHeaders: HeaderMap;
  assertDynamicHeaders?: (headers: HeaderMap) => void;
};

const firstHeaderValue = (value: unknown) =>
  Array.isArray(value) ? value[0] : value;

const restoreStrictDefaultRequestId = (value: string | undefined) => {
  if (typeof value === 'undefined') {
    delete process.env.MODERN_BFF_STRICT_DEFAULT_REQUEST_ID;
    return;
  }
  process.env.MODERN_BFF_STRICT_DEFAULT_REQUEST_ID = value;
};

const createHarness = (
  target: TransportTarget,
  incomingHeaders: HeaderMap = {},
) => {
  const request = rs.fn(
    (_requestPath: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }))),
  );

  const requestFactory = createRequestFactory<typeof fetch>({
    target,
    getFetch: () => request as unknown as typeof fetch,
    originFetch: request as unknown as typeof fetch,
    readIncomingHeaders: () => incomingHeaders,
    resolveSourceOrigin: headers => {
      const origin = firstHeaderValue(headers.origin);
      if (typeof origin === 'string') {
        return origin;
      }

      const referer = firstHeaderValue(headers.referer);
      return typeof referer === 'string' ? referer : undefined;
    },
    createInputParamsBody: args => JSON.stringify({ args }),
    resolveRequestUrl: ({ configDomain, domain, path, port }) =>
      target === 'server'
        ? `${configDomain || `http://127.0.0.1:${port}`}${path}`
        : `${configDomain || domain || ''}${path}`,
    resolveUploadUrl: ({ configDomain, domain, path }) =>
      `${configDomain || domain || ''}${path}`,
  });

  return {
    request,
    requestFactory,
  };
};

const assertRequestInit = (scenario: OutboundScenario, init: RequestInit) => {
  const headers = init.headers as HeaderMap;

  expect(init.method).toBe(scenario.method);
  expect(init.body).toBe(scenario.expectedBody);
  expect(Object.keys(headers).sort()).toEqual(
    [...scenario.expectedHeaderKeys].sort(),
  );
  for (const [key, value] of Object.entries(scenario.expectedStaticHeaders)) {
    expect(headers[key]).toBe(value);
  }
  expect(
    Object.keys(headers).filter(key => key.toLowerCase() === 'accept'),
  ).toEqual(['accept']);

  scenario.assertDynamicHeaders?.(headers);
};

const outboundScenarios: OutboundScenario[] = [
  {
    name: 'browser GET strips caller body and canonicalizes accept',
    target: 'browser',
    method: 'GET',
    payload: {
      body: 'drop-me',
      headers: {
        Accept: 'application/problem+json',
      },
    },
    expectedUrl: REQUEST_PATH,
    expectedHeaderKeys: ['Content-Type', 'accept'],
    expectedStaticHeaders: {
      'Content-Type': 'text/plain',
      accept: ACCEPT_HEADER,
    },
  },
  {
    name: 'browser POST keeps caller body without propagating incoming traceparent',
    target: 'browser',
    method: 'POST',
    incomingHeaders: {
      traceparent: INCOMING_TRACEPARENT,
    },
    payload: {
      body: 'keep-me',
      headers: {
        Accept: 'application/problem+json',
      },
    },
    expectedUrl: REQUEST_PATH,
    expectedBody: 'keep-me',
    expectedHeaderKeys: ['Content-Type', 'accept'],
    expectedStaticHeaders: {
      'Content-Type': 'text/plain',
      accept: ACCEPT_HEADER,
    },
  },
  {
    name: 'server GET strips caller body and propagates incoming traceparent',
    target: 'server',
    method: 'GET',
    incomingHeaders: {
      traceparent: INCOMING_TRACEPARENT,
    },
    payload: {
      body: 'drop-me',
      headers: {
        Accept: 'application/problem+json',
      },
    },
    expectedUrl: SERVER_URL,
    expectedHeaderKeys: ['Content-Type', 'accept', 'traceparent'],
    expectedStaticHeaders: {
      'Content-Type': 'text/plain',
      accept: ACCEPT_HEADER,
      traceparent: INCOMING_TRACEPARENT,
    },
  },
  {
    name: 'server POST keeps caller body and propagates incoming traceparent',
    target: 'server',
    method: 'POST',
    incomingHeaders: {
      traceparent: INCOMING_TRACEPARENT,
    },
    payload: {
      body: 'keep-me',
      headers: {
        Accept: 'application/problem+json',
      },
    },
    expectedUrl: SERVER_URL,
    expectedBody: 'keep-me',
    expectedHeaderKeys: ['Content-Type', 'accept', 'traceparent'],
    expectedStaticHeaders: {
      'Content-Type': 'text/plain',
      accept: ACCEPT_HEADER,
      traceparent: INCOMING_TRACEPARENT,
    },
  },
  {
    name: 'protected identity binding replaces caller case variant',
    target: 'server',
    method: 'POST',
    payload: {
      body: 'keep-me',
      headers: {
        Accept: 'application/problem+json',
        'X-Tenant-Id': 'caller-tenant',
      },
    },
    identityBinding: {
      enabled: true,
      strict: false,
      protectedHeaders: ['x-tenant-id'],
      deriveHeaders: () => ({
        'x-tenant-id': 'bound-tenant',
      }),
    },
    expectedUrl: SERVER_URL,
    expectedBody: 'keep-me',
    expectedHeaderKeys: ['Content-Type', 'accept', 'x-tenant-id'],
    expectedStaticHeaders: {
      'Content-Type': 'text/plain',
      accept: ACCEPT_HEADER,
      'x-tenant-id': 'bound-tenant',
    },
  },
  {
    name: 'configured secured request emits envelope and operation context',
    target: 'server',
    method: 'POST',
    requestId: 'producer-checkout',
    domain: 'https://producer.example',
    incomingHeaders: {
      origin: CONSUMER_ORIGIN,
    },
    payload: {
      body: 'keep-me',
      headers: {
        Accept: 'application/problem+json',
      },
    },
    requireEnvelope: true,
    allowCrossOriginEnvelope: true,
    operationContract: {
      enabled: true,
      requireSchemaHash: true,
      requireOperationVersion: true,
    },
    operationContext: {
      operationId: 'create-widget',
      routePath: REQUEST_PATH,
      method: 'POST',
      schemaHash: 'sha256:create-widget',
      operationVersion: 3,
      traceparent: OPERATION_TRACEPARENT,
    },
    expectedUrl: PRODUCER_URL,
    expectedBody: 'keep-me',
    expectedHeaderKeys: [
      'Content-Type',
      'accept',
      'traceparent',
      BFF_ENVELOPE_HEADER,
      BFF_OPERATION_CONTEXT_HEADER,
      BFF_OPERATION_CONTEXT_DETAIL_HEADER,
    ],
    expectedStaticHeaders: {
      'Content-Type': 'text/plain',
      accept: ACCEPT_HEADER,
      traceparent: OPERATION_TRACEPARENT,
      [BFF_OPERATION_CONTEXT_HEADER]: 'producer-checkout:create-widget',
    },
    assertDynamicHeaders: headers => {
      const envelope = JSON.parse(headers[BFF_ENVELOPE_HEADER]);
      expect(envelope).toMatchObject({
        requestId: 'producer-checkout',
        target: 'server',
        sourceOrigin: CONSUMER_ORIGIN,
        targetOrigin: 'https://producer.example',
        traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        spanId: 'bbbbbbbbbbbbbbbb',
      });
      expect(typeof envelope.timestamp).toBe('number');

      const operationContext = JSON.parse(
        headers[BFF_OPERATION_CONTEXT_DETAIL_HEADER],
      );
      expect(operationContext).toMatchObject({
        requestId: 'producer-checkout',
        operationId: 'producer-checkout:create-widget',
        routePath: REQUEST_PATH,
        method: 'POST',
        schemaHash: 'sha256:create-widget',
        operationVersion: 3,
        traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        spanId: 'bbbbbbbbbbbbbbbb',
      });
    },
  },
];

describe('requestFactory outbound request contract', () => {
  for (const scenario of outboundScenarios) {
    test(scenario.name, async () => {
      const strictDefaultRequestId =
        process.env.MODERN_BFF_STRICT_DEFAULT_REQUEST_ID;
      delete process.env.MODERN_BFF_STRICT_DEFAULT_REQUEST_ID;

      try {
        const { request, requestFactory } = createHarness(
          scenario.target,
          scenario.incomingHeaders,
        );
        const requestId = scenario.requestId || 'default';

        requestFactory.configure({
          request: request as unknown as typeof fetch,
          requestId,
          ...(requestId !== 'default'
            ? { setDomain: () => scenario.domain || '' }
            : {}),
          ...(scenario.identityBinding
            ? { identityBinding: scenario.identityBinding }
            : {}),
          ...(typeof scenario.requireEnvelope === 'boolean'
            ? { requireEnvelope: scenario.requireEnvelope }
            : {}),
          ...(typeof scenario.allowCrossOriginEnvelope === 'boolean'
            ? { allowCrossOriginEnvelope: scenario.allowCrossOriginEnvelope }
            : {}),
          ...(scenario.operationContract
            ? { operationContract: scenario.operationContract }
            : {}),
        });

        const send = requestFactory.createRequest({
          path: REQUEST_PATH,
          method: scenario.method,
          port: PORT,
          requestId,
          operationContext: scenario.operationContext,
        });

        await send(scenario.payload);

        expect(request).toHaveBeenCalledTimes(1);
        const [url, init] = request.mock.calls[0];
        expect(String(url)).toBe(scenario.expectedUrl);
        assertRequestInit(scenario, init as RequestInit);
      } finally {
        restoreStrictDefaultRequestId(strictDefaultRequestId);
      }
    });
  }

  test('inputParams forwards only allowlisted and server-derived identity headers', async () => {
    const requestId = 'producer-input-params-identity';
    const { request, requestFactory } = createHarness('server', {
      'x-tenant-id': 'tenant-server',
      'x-subject-id': 'subject-server',
      'x-forwarded-feature': 'feature-server',
      'x-private-incoming': 'must-not-forward',
    });

    requestFactory.configure({
      request: request as unknown as typeof fetch,
      requestId,
      allowedHeaders: ['x-forwarded-feature'],
      operationContract: { enabled: false },
      requireEnvelope: false,
      setDomain: () => 'https://producer.example',
    });

    const send = requestFactory.createRequest({
      path: REQUEST_PATH,
      method: 'POST',
      port: PORT,
      httpMethodDecider: 'inputParams',
      requestId,
    });

    await send('widget');

    expect(request).toHaveBeenCalledTimes(1);
    const headers = request.mock.calls[0][1]?.headers as HeaderMap;
    expect(headers).toMatchObject({
      'x-tenant-id': 'tenant-server',
      'x-subject-id': 'subject-server',
      'x-forwarded-feature': 'feature-server',
    });
    expect(headers['x-private-incoming']).toBeUndefined();
  });

  test('uploader forwards only allowlisted and server-derived identity headers', async () => {
    const requestId = 'producer-uploader-identity';
    const { request, requestFactory } = createHarness('server', {
      'x-tenant-id': 'tenant-server',
      'x-subject-id': 'subject-server',
      'x-forwarded-feature': 'feature-server',
      'x-private-incoming': 'must-not-forward',
    });

    requestFactory.configure({
      request: request as unknown as typeof fetch,
      requestId,
      allowedHeaders: ['x-forwarded-feature'],
      operationContract: { enabled: false },
      requireEnvelope: false,
      setDomain: () => 'https://producer.example',
    });

    const upload = requestFactory.createUploader({
      path: REQUEST_PATH,
      requestId,
    });

    await upload({
      files: {
        file: new File(['widget'], 'widget.txt', { type: 'text/plain' }),
      },
    });

    expect(request).toHaveBeenCalledTimes(1);
    const headers = request.mock.calls[0][1]?.headers as HeaderMap;
    expect(headers).toMatchObject({
      'x-tenant-id': 'tenant-server',
      'x-subject-id': 'subject-server',
      'x-forwarded-feature': 'feature-server',
    });
    expect(headers['x-private-incoming']).toBeUndefined();
  });

  test('forwards allowlisted and resolved headers without casing assumptions', async () => {
    const resolveHeaders = rs.fn(() => ({
      AUTHORIZATION: 'Bearer resolved',
    }));
    const { request, requestFactory } = createHarness('server', {
      Authorization: 'Bearer incoming',
    });

    requestFactory.configure({
      request: request as unknown as typeof fetch,
      allowedHeaders: ['authorization'],
      resolveHeaders,
    });

    const send = requestFactory.createRequest({
      path: REQUEST_PATH,
      method: 'GET',
      port: PORT,
    });
    await send({
      headers: { Authorization: 'Bearer caller' },
    });

    expect(resolveHeaders).toHaveBeenCalledWith(
      expect.objectContaining({
        incomingHeaders: { authorization: 'Bearer incoming' },
      }),
    );
    const headers = request.mock.calls[0][1]?.headers as HeaderMap;
    expect(headers).toMatchObject({
      authorization: 'Bearer resolved',
    });
    expect(
      Object.keys(headers).filter(key => key.toLowerCase() === 'authorization'),
    ).toEqual(['authorization']);
  });

  test('reconfiguration removes omitted header and envelope policy', async () => {
    const resolveHeaders = rs.fn(() => ({
      authorization: 'Bearer stale',
    }));
    const { request, requestFactory } = createHarness('server', {
      authorization: 'Bearer incoming',
    });

    requestFactory.configure({
      request: request as unknown as typeof fetch,
      allowedHeaders: ['authorization'],
      resolveHeaders,
      requireEnvelope: true,
      identityBinding: {
        enabled: true,
        strict: false,
        protectedHeaders: ['x-user-id'],
        deriveHeaders: () => ({ 'x-user-id': 'stale-user' }),
      },
    });
    requestFactory.configure({
      request: request as unknown as typeof fetch,
    });

    const send = requestFactory.createRequest({
      path: REQUEST_PATH,
      method: 'GET',
      port: PORT,
    });
    await send();

    expect(resolveHeaders).not.toHaveBeenCalled();
    expect(request.mock.calls[0][1]?.headers).toEqual({
      accept: ACCEPT_HEADER,
    });
  });

  test('reconfiguration removes omitted retry policy', async () => {
    const failure = Object.assign(new Error('unavailable'), { status: 503 });
    const request = rs.fn(async () => {
      throw failure;
    });
    const { requestFactory } = createHarness('server');

    requestFactory.configure({
      request: request as unknown as typeof fetch,
      transport: {
        retry: {
          retries: 1,
          baseDelayMs: 1,
          maxDelayMs: 1,
          jitterRatio: 0,
        },
      },
    });
    requestFactory.configure({
      request: request as unknown as typeof fetch,
    });

    const send = requestFactory.createRequest({
      path: REQUEST_PATH,
      method: 'GET',
      port: PORT,
    });

    await expect(send()).rejects.toBe(failure);
    expect(request).toHaveBeenCalledTimes(1);
  });

  test('reconfiguration restores omitted secured-producer defaults', () => {
    const requestId = 'producer-policy-reset';
    const { request, requestFactory } = createHarness('server');

    requestFactory.configure({
      request: request as unknown as typeof fetch,
      requestId,
      requireEnvelope: false,
      identityBinding: { enabled: false },
      operationContract: { enabled: false },
      setDomain: () => 'https://producer.example',
    });
    requestFactory.configure({
      request: request as unknown as typeof fetch,
      requestId,
    });

    const send = requestFactory.createRequest({
      path: REQUEST_PATH,
      method: 'GET',
      port: PORT,
      requestId,
    });

    expect(() => send()).toThrow('missing_schema_hash');
  });

  test('uploader uses an explicitly configured POST retry policy', async () => {
    rs.useFakeTimers();
    const retryableError = Object.assign(new Error('upload unavailable'), {
      status: 503,
    });
    const response = new Response('{}', { status: 200 });
    const onDegraded = rs.fn();
    let attempts = 0;
    const request = rs.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw retryableError;
      }
      return response;
    });
    const { requestFactory } = createHarness('server');

    requestFactory.configure({
      request: request as unknown as typeof fetch,
      transport: {
        retry: {
          retries: 1,
          baseDelayMs: 5,
          maxDelayMs: 5,
          jitterRatio: 0,
          shouldRetry: ({ method }) => method === 'POST',
        },
        onDegraded,
      },
    });
    const upload = requestFactory.createUploader({ path: REQUEST_PATH });
    const pending = upload({
      files: { file: new File(['widget'], 'widget.txt') },
    });
    const observed = pending.catch(error => error);

    try {
      await Promise.resolve();
      expect(request).toHaveBeenCalledTimes(1);
      await rs.advanceTimersByTimeAsync(5);

      await expect(pending).resolves.toBe(response);
      expect(request).toHaveBeenCalledTimes(2);
      expect(onDegraded).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'retry',
          method: 'POST',
          attempt: 1,
          maxAttempts: 2,
        }),
      );
    } finally {
      await rs.advanceTimersByTimeAsync(1000);
      await observed;
      rs.useRealTimers();
    }
  });

  test('uploader timeout aborts transport and emits degraded telemetry', async () => {
    rs.useFakeTimers();
    const onDegraded = rs.fn();
    const cleanupError = new Error('test cleanup');
    let rejectRequest: ((error: Error) => void) | undefined;
    let inFlightSignal: AbortSignal | undefined;
    const request = rs.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      inFlightSignal = init?.signal || undefined;
      return new Promise((_, reject) => {
        rejectRequest = reject;
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    });
    const { requestFactory } = createHarness('server');

    requestFactory.configure({
      request: request as unknown as typeof fetch,
      transport: {
        timeoutMs: 20,
        onDegraded,
      },
    });
    const upload = requestFactory.createUploader({ path: REQUEST_PATH });
    const pending = upload({
      files: { file: new File(['widget'], 'widget.txt') },
    });
    const observed = pending.catch(error => error);

    try {
      await Promise.resolve();
      expect(inFlightSignal).toBeDefined();
      await rs.advanceTimersByTimeAsync(20);

      await expect(observed).resolves.toMatchObject({ name: 'TimeoutError' });
      expect(inFlightSignal?.aborted).toBe(true);
      expect(onDegraded).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'timeout',
          method: 'POST',
          timeoutMs: 20,
        }),
      );
    } finally {
      if (!inFlightSignal?.aborted) {
        rejectRequest?.(cleanupError);
      }
      await observed;
      await rs.advanceTimersByTimeAsync(1000);
      rs.useRealTimers();
    }
  });
});
