/**
 * @jest-environment node
 */

import { createRequire } from 'node:module';
import path from 'path';

const projectRoot = path.resolve(__dirname, '../../..');
const crossProjectApiApp = path.join(
  projectRoot,
  'integration/bff-cross-project/bff-api-app',
);
const requireFromApiApp = createRequire(
  path.join(crossProjectApiApp, 'package.json'),
);

const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

const effectManifest = {
  endpoints: [
    {
      apiId: 'CrossProjectEffectApi',
      group: 'greetings',
      endpoint: 'hello',
      method: 'GET',
      routePath: '/api-app/effect/hello',
      schemaHash: 'a'.repeat(64),
      operationVersion: 2,
    },
    {
      apiId: 'CrossProjectEffectApi',
      group: 'greetings',
      endpoint: 'traceHeader',
      method: 'GET',
      routePath: '/api-app/effect/trace-header',
      schemaHash: 'b'.repeat(64),
      operationVersion: 2,
    },
  ],
};

const createConfig = (port = 3399) => ({
  appNamespace: 'bff-api-app',
  requestId: 'bff-api-app',
  port,
  defaultOrigin: `http://127.0.0.1:${port}`,
  httpMethodDecider: 'functionName',
  batch: {
    enabled: false,
    endpoint: '/api-app/_data/batch',
    flushIntervalMs: 8,
    maxBatchSize: 16,
    maxBatchBytes: 65536,
    requestTimeoutMs: 10000,
    allowedMethods: ['GET'],
  },
});

describe('effect-only cross-project BFF contracts', () => {
  test('effect-client runtime builds operation manifest and request contracts', () => {
    const runtime = requireFromApiApp(
      '@modern-js/plugin-bff/effect-client-runtime',
    );
    const createRequestCalls: Array<Record<string, any>> = [];
    const requestRuntime = {
      createRequest: (options: Record<string, any>) => {
        createRequestCalls.push(options);
        return () => Promise.resolve({ ok: true });
      },
    };

    const generated = runtime.createGeneratedEffectClient(
      effectManifest,
      createConfig(),
      requestRuntime,
    );

    expect(Object.keys(generated.client)).toEqual(['greetings']);
    expect(typeof generated.client.greetings.hello).toBe('function');
    expect(typeof generated.client.greetings.traceHeader).toBe('function');
    expect(typeof generated.createEffectRequestContext).toBe('function');
    expect(generated.operationManifest.greetings.hello).toMatchObject({
      apiId: 'CrossProjectEffectApi',
      appNamespace: 'bff-api-app',
      operationId: 'GET:/api-app/effect/hello',
      routePath: '/api-app/effect/hello',
      method: 'GET',
      schemaHash: 'a'.repeat(64),
      operationVersion: 2,
      version: 2,
    });
    expect(
      createRequestCalls.map(call => call.operationContext.operationId),
    ).toEqual([
      'GET:/api-app/effect/hello',
      'GET:/api-app/effect/trace-header',
    ]);
  });

  test('effect-client runtime preserves strict envelope fallback semantics', async () => {
    const runtime = requireFromApiApp(
      '@modern-js/plugin-bff/effect-client-runtime',
    );
    const dataPlatform = requireFromApiApp(
      '@modern-js/plugin-bff/data-platform',
    );
    const sentPayloads: Array<Record<string, any>> = [];
    const createRequestCalls: Array<Record<string, any>> = [];
    const requestRuntime = {
      createRequest: (options: Record<string, any>) => {
        createRequestCalls.push(options);
        return (payload: Record<string, any>) => {
          sentPayloads.push(payload);
          return Promise.resolve({ ok: true });
        };
      },
    };

    const generated = runtime.createGeneratedEffectClient(
      { endpoints: [effectManifest.endpoints[0]] },
      createConfig(),
      requestRuntime,
    );

    expect(createRequestCalls[0].operationContext).toMatchObject({
      operationId: 'GET:/api-app/effect/hello',
      routePath: '/api-app/effect/hello',
      method: 'GET',
      schemaHash: 'a'.repeat(64),
      operationVersion: 2,
    });

    await expect(
      Promise.resolve().then(() =>
        generated.client.greetings.hello({
          dataPlatform: { requireEnvelope: true, requireTraceContext: true },
        }),
      ),
    ).rejects.toThrow(/Trace context (is )?required/);

    sentPayloads.length = 0;
    await expect(
      generated.client.greetings.hello({
        dataPlatform: { requireTraceContext: true },
      }),
    ).resolves.toEqual({ ok: true });
    expect(sentPayloads).toHaveLength(1);
    expect(
      sentPayloads[0].headers?.[dataPlatform.DEFAULT_DATA_ENVELOPE_HEADER],
    ).toBeUndefined();

    sentPayloads.length = 0;
    await expect(
      generated.client.greetings.hello({
        requestContext: { traceparent },
        dataPlatform: { allowCrossOriginEnvelope: true, batch: false },
      }),
    ).resolves.toEqual({ ok: true });
    expect(sentPayloads).toHaveLength(1);
    const headers = sentPayloads[0].headers;
    expect(headers[dataPlatform.DEFAULT_DATA_BATCH_HEADER]).toBe('off');
    expect(typeof headers[dataPlatform.DEFAULT_DATA_ENVELOPE_HEADER]).toBe(
      'string',
    );
    expect(
      headers[dataPlatform.DEFAULT_DATA_ENVELOPE_HEADER].length,
    ).toBeGreaterThan(0);
  });

  test('generated effect client requestContext propagates locale and traceparent into request payload', async () => {
    const runtime = requireFromApiApp(
      '@modern-js/plugin-bff/effect-client-runtime',
    );
    const dataPlatform = requireFromApiApp(
      '@modern-js/plugin-bff/data-platform',
    );
    const sentPayloads: Array<Record<string, any>> = [];
    const requestRuntime = {
      createRequest: () => (payload: Record<string, any>) => {
        sentPayloads.push(payload);
        return Promise.resolve({ ok: true });
      },
    };
    const generated = runtime.createGeneratedEffectClient(
      effectManifest,
      createConfig(),
      requestRuntime,
    );
    const requestContext = generated.createEffectRequestContext({
      locale: 'cs-CZ',
      traceparent,
    });

    await expect(
      generated.client.greetings.traceHeader({
        requestContext,
        dataPlatform: { batch: false },
      }),
    ).resolves.toEqual({ ok: true });

    expect(sentPayloads).toHaveLength(1);
    expect(sentPayloads[0].requestContext).toMatchObject({
      locale: 'cs-CZ',
      traceparent,
    });
    const envelope = JSON.parse(
      decodeURIComponent(
        sentPayloads[0].headers[dataPlatform.DEFAULT_DATA_ENVELOPE_HEADER],
      ),
    );
    expect(envelope).toMatchObject({
      appNamespace: 'bff-api-app',
      protocolVersion: 1,
    });
    expect(envelope.operationId).toMatch(
      /^bff-api-app\.CrossProjectEffectApi\.greetings\.traceHeader\.v2:/,
    );
  });
});
