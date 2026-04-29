import {
  createOtlpTelemetryExporter,
  createVictoriaMetricsTelemetryExporter,
  TelemetryRegistry,
} from '../../src/plugins/telemetry';

const createEnvelope = (partial: Record<string, unknown> = {}) => ({
  timestamp: Date.now(),
  service: 'svc',
  module: 'server',
  environment: 'test',
  signalType: 'metric' as const,
  name: 'server.handle.request',
  value: 10,
  unit: 'ms',
  ...partial,
});

describe('telemetry registry', () => {
  test('applies redaction and emits dropped-count metric under backpressure', async () => {
    const batches: unknown[] = [];
    const registry = new TelemetryRegistry({
      service: 'svc',
      module: 'server',
      environment: 'test',
      maxBatchSize: 10,
      maxQueueSize: 3,
      flushIntervalMs: 60_000,
      redactionKeys: ['token'],
    });
    await registry.register({
      name: 'memory',
      async emit(batch) {
        batches.push(...batch);
      },
    });

    registry.enqueue(
      createEnvelope({
        name: 'first',
        attributes: { token: 's1', keep: 'ok' },
      }),
    );
    registry.enqueue(
      createEnvelope({
        name: 'second',
      }),
    );
    registry.enqueue(
      createEnvelope({
        name: 'third',
      }),
    );
    registry.enqueue(
      createEnvelope({
        name: 'fourth',
      }),
    );

    await registry.flush();
    await registry.shutdown();

    const names = batches.map(
      item => (item as { name?: string }).name || 'unknown',
    );
    expect(names).toContain('telemetry.queue.dropped');
    const withAttributes = batches.find(
      item => (item as { name?: string }).name === 'first',
    ) as
      | {
          attributes?: Record<string, unknown>;
        }
      | undefined;
    expect(withAttributes).toBeUndefined();
  });

  test('redacts configured keys recursively', async () => {
    const batches: unknown[] = [];
    const registry = new TelemetryRegistry({
      service: 'svc',
      module: 'server',
      environment: 'test',
      flushIntervalMs: 60_000,
      redactionKeys: ['token'],
    });
    await registry.register({
      name: 'memory',
      async emit(batch) {
        batches.push(...batch);
      },
    });

    registry.enqueue(
      createEnvelope({
        name: 'sensitive',
        attributes: {
          token: 'secret',
          nested: {
            token: 'inner-secret',
            keep: true,
          },
        },
      }),
    );

    await registry.flush();
    await registry.shutdown();

    const item = batches.find(
      entry => (entry as { name?: string }).name === 'sensitive',
    ) as
      | {
          attributes?: {
            token?: string;
            nested?: {
              token?: string;
              keep?: boolean;
            };
          };
        }
      | undefined;
    expect(item).toBeDefined();
    expect(item?.attributes?.token).toBe('[REDACTED]');
    expect(item?.attributes?.nested?.token).toBe('[REDACTED]');
    expect(item?.attributes?.nested?.keep).toBe(true);
  });
});

describe('telemetry exporters', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('otlp exporter sends envelope batch with JSON body', async () => {
    const mockFetch = rs.fn(async () => new Response('ok', { status: 200 }));
    globalThis.fetch = mockFetch as typeof fetch;

    const exporter = createOtlpTelemetryExporter({
      endpoint: 'http://localhost:4318/v1/logs',
    });
    await exporter.emit([
      createEnvelope({
        signalType: 'log',
        name: 'hello',
        level: 'info',
      }),
    ]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:4318/v1/logs');
    expect(init.method).toBe('POST');
    const payload = JSON.parse(String(init.body)) as {
      events: unknown[];
    };
    expect(payload.events).toHaveLength(1);
  });

  test('victoria metrics exporter emits prometheus lines', async () => {
    const mockFetch = rs.fn(async () => new Response('ok', { status: 200 }));
    globalThis.fetch = mockFetch as typeof fetch;

    const exporter = createVictoriaMetricsTelemetryExporter({
      endpoint: 'http://localhost:8428/api/v1/import/prometheus',
      metricPrefix: 'modernjs',
    });
    await exporter.emit([
      createEnvelope({
        signalType: 'metric',
        name: 'server.handle.request',
        value: 42,
      }),
      createEnvelope({
        signalType: 'log',
        name: 'request.error',
        level: 'error',
      }),
    ]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8428/api/v1/import/prometheus');
    expect(init.method).toBe('POST');
    const body = String(init.body);
    expect(body).toContain('modernjs_metric_server_handle_request');
    expect(body).toContain('modernjs_log_request_error');
  });
});
