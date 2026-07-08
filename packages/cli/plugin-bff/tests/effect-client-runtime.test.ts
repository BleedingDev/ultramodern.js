import { decodeRequestEnvelopeHeader } from '../src/runtime/data-platform';
import {
  createGeneratedEffectClient,
  type EffectRequestRuntime,
  type GeneratedEffectClientConfig,
  type GeneratedEffectEndpoint,
} from '../src/runtime/effect-client/runtime';

const PING_ENDPOINT: GeneratedEffectEndpoint = {
  apiId: 'TestApi',
  group: 'greetings',
  endpoint: 'ping',
  method: 'GET',
  routePath: '/api/ping',
  schemaHash: 'hash-ping',
  operationVersion: 3,
};

const createConfig = (
  overrides: Partial<GeneratedEffectClientConfig> = {},
): GeneratedEffectClientConfig => ({
  appNamespace: 'test-app',
  port: 8080,
  defaultOrigin: 'http://localhost:8080',
  httpMethodDecider: 'functionName',
  batch: {
    enabled: false,
    endpoint: '/api/_data/batch',
    flushIntervalMs: 8,
    maxBatchSize: 16,
    maxBatchBytes: 64 * 1024,
    requestTimeoutMs: 10_000,
    allowedMethods: ['GET'],
  },
  ...overrides,
});

const createStubRuntime = () => {
  const createRequestCalls: any[] = [];
  const senderCalls: any[] = [];
  const configureCalls: any[] = [];

  const runtime: EffectRequestRuntime = {
    createRequest: options => {
      createRequestCalls.push(options);
      return async (...args: unknown[]) => {
        senderCalls.push({ options, args });
        return { ok: true };
      };
    },
    configure: options => {
      configureCalls.push(options);
    },
    createRequestContextHeaders: () => ({ 'x-context': 'yes' }),
  };

  return { runtime, createRequestCalls, senderCalls, configureCalls };
};

describe('effect-client runtime (createGeneratedEffectClient)', () => {
  test('builds a grouped client and operation manifest from the endpoint manifest', async () => {
    const { runtime, createRequestCalls, senderCalls } = createStubRuntime();

    const generated = createGeneratedEffectClient(
      { endpoints: [PING_ENDPOINT] },
      createConfig(),
      runtime,
    );

    expect(Object.keys(generated.client)).toEqual(['greetings']);
    expect(typeof generated.client.greetings!.ping).toBe('function');
    expect(generated.operationManifest.greetings!.ping).toMatchObject({
      apiId: 'TestApi',
      operationId: 'GET:/api/ping',
      schemaHash: 'hash-ping',
      operationVersion: 3,
      version: 3,
    });

    expect(createRequestCalls).toHaveLength(1);
    expect(createRequestCalls[0]).toMatchObject({
      path: '/api/ping',
      method: 'GET',
      port: 8080,
      httpMethodDecider: 'functionName',
      operationContext: {
        operationId: 'GET:/api/ping',
        schemaHash: 'hash-ping',
        operationVersion: 3,
      },
    });

    await generated.client.greetings!.ping({});
    expect(senderCalls).toHaveLength(1);
  });

  test('attaches the data envelope header for same-origin requests', async () => {
    const { runtime, senderCalls } = createStubRuntime();

    const generated = createGeneratedEffectClient(
      { endpoints: [PING_ENDPOINT] },
      createConfig(),
      runtime,
    );

    await generated.client.greetings!.ping({
      urlParams: { q: '1' },
      dataPlatform: { origin: 'http://localhost:8080' },
    });

    const payload = senderCalls[0]!.args[0] as Record<string, any>;
    expect(payload.query).toEqual({ q: '1' });
    const encodedEnvelope = payload.headers['x-modernjs-data-envelope'];
    expect(typeof encodedEnvelope).toBe('string');
    const envelope = decodeRequestEnvelopeHeader(encodedEnvelope);
    expect(envelope).toMatchObject({
      protocolVersion: 1,
      appNamespace: 'test-app',
    });
    // data-platform operation id format: ns.api.group.endpoint.vN:hash
    expect(envelope!.operationId).toContain(
      'test-app.TestApi.greetings.ping.v3',
    );
  });

  test('configures the cross-project producer client when a requestId is present', () => {
    const { runtime, configureCalls, createRequestCalls } = createStubRuntime();

    createGeneratedEffectClient(
      { endpoints: [PING_ENDPOINT] },
      createConfig({ requestId: 'producer-app' }),
      runtime,
    );

    expect(configureCalls).toHaveLength(1);
    expect(configureCalls[0]).toMatchObject({
      requestId: 'producer-app',
      requireEnvelope: true,
      identityBinding: { enabled: true, strict: true },
      operationContract: {
        enabled: true,
        strict: true,
        requireSchemaHash: true,
        requireOperationVersion: true,
      },
    });
    expect(typeof configureCalls[0].setDomain).toBe('function');
    expect(configureCalls[0].setDomain()).toBe('http://localhost:8080');

    expect(createRequestCalls[0]).toMatchObject({ requestId: 'producer-app' });
  });

  test('skips configure for same-project clients', () => {
    const { runtime, configureCalls, createRequestCalls } = createStubRuntime();

    createGeneratedEffectClient(
      { endpoints: [PING_ENDPOINT] },
      createConfig(),
      runtime,
    );

    expect(configureCalls).toHaveLength(0);
    expect(createRequestCalls[0]!.requestId).toBeUndefined();
  });

  test('merges request context headers without clobbering caller headers', async () => {
    const { runtime, senderCalls } = createStubRuntime();

    const generated = createGeneratedEffectClient(
      { endpoints: [PING_ENDPOINT] },
      createConfig(),
      runtime,
    );

    await generated.client.greetings!.ping({
      headers: { 'x-caller': 'yes' },
      requestContext: { locale: 'en' },
      dataPlatform: { batch: false },
    });

    const payload = senderCalls[0]!.args[0] as Record<string, any>;
    expect(payload.headers['x-caller']).toBe('yes');
    expect(payload.headers['x-context']).toBe('yes');
    expect(payload.headers['x-modernjs-data-batch']).toBe('off');
  });

  test('keeps generated request context headers when caller headers collide', async () => {
    const { runtime, senderCalls } = createStubRuntime();
    runtime.createRequestContextHeaders = requestContext => ({
      traceparent: String(requestContext.traceparent),
      'x-operation-id': String(requestContext.operationContext?.operationId),
    });

    const generated = createGeneratedEffectClient(
      { endpoints: [PING_ENDPOINT] },
      createConfig(),
      runtime,
    );

    await generated.client.greetings!.ping({
      headers: {
        traceparent: '00-spoofedtrace000000000000000000000-spoofedspan0000-01',
        'x-operation-id': 'spoofed-operation',
        'x-caller': 'yes',
      },
      requestContext: {
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
        operationContext: {
          operationId: 'trusted-operation',
        },
      },
      dataPlatform: { batch: false },
    });

    const payload = senderCalls[0]!.args[0] as Record<string, any>;
    expect(payload.headers.traceparent).toBe(
      '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    );
    expect(payload.headers['x-operation-id']).toBe('trusted-operation');
    expect(payload.headers['x-caller']).toBe('yes');
  });
});
