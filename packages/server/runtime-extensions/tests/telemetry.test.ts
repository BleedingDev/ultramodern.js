import {
  createOtlpTelemetryExporter,
  createTelemetryAwareMetrics,
  createVictoriaMetricsTelemetryExporter,
  type TelemetryEnvelope,
  TelemetryRegistry,
  TelemetryStartupHealthError,
} from '../src/telemetry';
import { clamp } from '../src/telemetry/envelope';

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

describe('telemetry envelope helpers', () => {
  test('clamps NaN input to a finite in-range value', () => {
    const value = clamp(Number.NaN, 0, 1);

    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  });
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

  test('wraps metrics and preserves trace tags in envelopes', async () => {
    const emitted: TelemetryEnvelope[] = [];
    const registry = new TelemetryRegistry({
      service: 'svc',
      module: 'server',
      environment: 'test',
      flushIntervalMs: 60_000,
    });
    await registry.register({
      name: 'memory',
      async emit(batch) {
        emitted.push(...batch);
      },
    });

    const base = {
      gauges: rs.fn(),
      emitCounter: rs.fn(),
      emitTimer: rs.fn(),
    };
    const metrics = createTelemetryAwareMetrics(base as any, registry);
    metrics.emitCounter('server.request.count', 1, {
      pathname: '/foo',
      trace_id: '11112222333344445555666677778888',
    });
    metrics.emitTimer('server.request.cost', 25, {
      pathname: '/foo',
      span_id: '1111222233334444',
    });

    await registry.flush();
    await registry.shutdown();

    expect(base.emitCounter).toHaveBeenCalledTimes(1);
    expect(base.emitTimer).toHaveBeenCalledTimes(1);

    const countEnvelope = emitted.find(
      item => item.name === 'server.request.count',
    )!;
    const timerEnvelope = emitted.find(
      item => item.name === 'server.request.cost',
    )!;

    expect(countEnvelope.unit).toBe('count');
    expect(countEnvelope.traceId).toBe('11112222333344445555666677778888');
    expect(timerEnvelope.unit).toBe('ms');
    expect(timerEnvelope.spanId).toBe('1111222233334444');
  });

  test('emits queue depth and utilization metrics during flush', async () => {
    const emitted: TelemetryEnvelope[] = [];
    const registry = new TelemetryRegistry({
      service: 'svc',
      module: 'server',
      environment: 'test',
      maxQueueSize: 10,
      flushIntervalMs: 60_000,
    });
    await registry.register({
      name: 'memory',
      async emit(batch) {
        emitted.push(...batch);
      },
    });

    registry.enqueue(createEnvelope({ name: 'a' }));
    registry.enqueue(createEnvelope({ name: 'b' }));
    await registry.flush();

    const depthEnvelope = emitted.find(
      item => item.name === 'telemetry.queue.depth',
    );
    const utilizationEnvelope = emitted.find(
      item => item.name === 'telemetry.queue.utilization',
    );
    expect(depthEnvelope?.value).toBe(2);
    expect(utilizationEnvelope?.value).toBe(0.2);
    await registry.shutdown();
  });

  test('exposes queue stats and emits SLO alerts for utilization and dropped envelopes', async () => {
    const alerts: Array<{ type: string; value: number }> = [];
    const registry = new TelemetryRegistry({
      service: 'svc',
      module: 'server',
      environment: 'test',
      maxQueueSize: 2,
      flushIntervalMs: 60_000,
      slo: {
        queueUtilizationWarnThreshold: 0.5,
        queueDroppedWarnThreshold: 1,
        alertCooldownMs: 0,
        onAlert(alert) {
          alerts.push({ type: alert.type, value: alert.value });
        },
      },
    });

    registry.enqueue(createEnvelope({ name: 'first' }));
    registry.enqueue(createEnvelope({ name: 'second' }));
    registry.enqueue(createEnvelope({ name: 'third' }));

    const queueStats = registry.getQueueStats();
    expect(queueStats.depth).toBe(2);
    expect(queueStats.capacity).toBe(2);
    expect(queueStats.utilization).toBe(1);
    expect(queueStats.pendingDropped).toBe(1);
    expect(queueStats.totalDropped).toBe(1);
    expect(alerts.some(item => item.type === 'queue.utilization')).toBe(true);
    expect(alerts.some(item => item.type === 'queue.drop')).toBe(true);
    await registry.shutdown();
  });

  test('drop SLO alerts use pending drop pressure instead of lifetime drops', async () => {
    const dropAlerts: Array<{ value: number; totalDropped: number }> = [];
    const registry = new TelemetryRegistry({
      service: 'svc',
      module: 'server',
      environment: 'test',
      maxQueueSize: 1,
      flushIntervalMs: 60_000,
      slo: {
        queueDroppedWarnThreshold: 2,
        alertCooldownMs: 0,
        onAlert(alert) {
          if (alert.type === 'queue.drop') {
            dropAlerts.push({
              value: alert.value,
              totalDropped: alert.totalDropped,
            });
          }
        },
      },
    });

    registry.enqueue(createEnvelope({ name: 'first' }));
    registry.enqueue(createEnvelope({ name: 'second' }));
    expect(registry.getQueueStats().pendingDropped).toBe(1);
    expect(dropAlerts).toEqual([]);

    await registry.flush();
    expect(registry.getQueueStats().pendingDropped).toBe(0);
    expect(registry.getQueueStats().totalDropped).toBe(1);

    registry.enqueue(createEnvelope({ name: 'third' }));
    registry.enqueue(createEnvelope({ name: 'fourth' }));

    expect(registry.getQueueStats().pendingDropped).toBe(1);
    expect(registry.getQueueStats().totalDropped).toBe(2);
    expect(dropAlerts).toEqual([]);
    await registry.shutdown();
  });

  test('startup health check fails loud by default when exporter is unhealthy', async () => {
    const registry = new TelemetryRegistry({
      service: 'svc',
      module: 'server',
      environment: 'test',
      flushIntervalMs: 60_000,
    });
    await registry.register({
      name: 'failing',
      async emit() {
        throw new Error('connection refused');
      },
    });

    await expect(registry.startupHealthCheck()).rejects.toBeInstanceOf(
      TelemetryStartupHealthError,
    );
    const health = registry.getExporterHealth();
    expect(health).toHaveLength(1);
    expect(health[0].healthy).toBe(false);
    expect(health[0].failures).toBeGreaterThan(0);
    await registry.shutdown();
  });

  test('startup health check can degrade without throwing when failLoud is false', async () => {
    const registry = new TelemetryRegistry({
      service: 'svc',
      module: 'server',
      environment: 'test',
      flushIntervalMs: 60_000,
    });
    await registry.register({
      name: 'failing',
      async emit() {
        throw new Error('connection refused');
      },
    });

    await expect(
      registry.startupHealthCheck({ failLoud: false }),
    ).resolves.toBeUndefined();
    const health = registry.getExporterHealth();
    expect(health).toHaveLength(1);
    expect(health[0].healthy).toBe(false);
    expect(health[0].failures).toBeGreaterThan(0);
    await registry.shutdown();
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
    const [url, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
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
    const [url, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('http://localhost:8428/api/v1/import/prometheus');
    expect(init.method).toBe('POST');
    const body = String(init.body);
    expect(body).toContain('modernjs_metric_server_handle_request');
    expect(body).toContain('modernjs_log_request_error');
  });
});
