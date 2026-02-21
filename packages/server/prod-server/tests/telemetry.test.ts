import { createServer } from 'http';
import type { IncomingHttpHeaders } from 'http';
import type { AddressInfo } from 'net';
import {
  TelemetryEnvelope,
  TelemetryRegistry,
  createOtlpTelemetryExporter,
  createTelemetryAwareMetrics,
  createVictoriaMetricsTelemetryExporter,
} from '../src/libs/telemetry';

const createEnvelope = (
  partial: Partial<TelemetryEnvelope> = {},
): TelemetryEnvelope => ({
  timestamp: Date.now(),
  service: 'svc',
  module: 'server',
  environment: 'test',
  signalType: 'metric',
  name: 'server.handle.request',
  value: 10,
  unit: 'ms',
  ...partial,
});

const createCaptureServer = async () => {
  const requests: Array<{
    headers: IncomingHttpHeaders;
    body: string;
  }> = [];

  const server = createServer((req, res) => {
    const chunks: string[] = [];
    req.on('data', chunk => {
      chunks.push(String(chunk));
    });
    req.on('end', () => {
      requests.push({
        headers: req.headers,
        body: chunks.join(''),
      });
      res.statusCode = 200;
      res.end('ok');
    });
  });

  await new Promise<void>(resolve => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;

  return {
    endpoint: `http://127.0.0.1:${port}/ingest`,
    requests,
    close: () =>
      new Promise<void>(resolve => {
        server.close(() => resolve());
      }),
  };
};

describe('telemetry registry', () => {
  test('applies redaction and emits dropped-count metric under backpressure', async () => {
    const emitted: TelemetryEnvelope[] = [];
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
        emitted.push(...batch);
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

    const names = emitted.map(item => item.name);
    expect(names).toContain('telemetry.queue.dropped');
    expect(names).not.toContain('first');
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
      gauges: jest.fn(),
      emitCounter: jest.fn(),
      emitTimer: jest.fn(),
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
    const timerEnvelope = emitted.find(item => item.name === 'server.request.cost')!;

    expect(countEnvelope.unit).toBe('count');
    expect(countEnvelope.traceId).toBe('11112222333344445555666677778888');
    expect(timerEnvelope.unit).toBe('ms');
    expect(timerEnvelope.spanId).toBe('1111222233334444');
  });
});

describe('telemetry exporters', () => {
  test('otlp exporter sends envelope batch with JSON body', async () => {
    const capture = await createCaptureServer();
    try {
      const exporter = createOtlpTelemetryExporter({
        endpoint: capture.endpoint,
      });

      await exporter.emit([
        createEnvelope({
          signalType: 'log',
          name: 'hello',
          level: 'info',
        }),
      ]);

      expect(capture.requests).toHaveLength(1);
      expect(capture.requests[0].headers['content-type']).toBe(
        'application/json',
      );
      const payload = JSON.parse(capture.requests[0].body) as {
        events: unknown[];
      };
      expect(payload.events).toHaveLength(1);
    } finally {
      await capture.close();
    }
  });

  test('victoria metrics exporter emits prometheus lines', async () => {
    const capture = await createCaptureServer();
    try {
      const exporter = createVictoriaMetricsTelemetryExporter({
        endpoint: capture.endpoint,
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

      expect(capture.requests).toHaveLength(1);
      expect(capture.requests[0].headers['content-type']).toBe(
        'text/plain; version=0.0.4',
      );
      expect(capture.requests[0].body).toContain(
        'modernjs_metric_server_handle_request',
      );
      expect(capture.requests[0].body).toContain('modernjs_log_request_error');
    } finally {
      await capture.close();
    }
  });
});
