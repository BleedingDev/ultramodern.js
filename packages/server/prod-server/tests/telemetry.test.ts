import type { IncomingHttpHeaders } from 'http';
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import {
  createOtlpTelemetryExporter,
  createTelemetryAwareMetrics,
  createVictoriaMetricsTelemetryExporter,
  TelemetryCanaryOrchestrator,
  type TelemetryEnvelope,
  TelemetryRegistry,
  TelemetryStartupHealthError,
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

describe('telemetry canary orchestrator', () => {
  test('supports dynamic required contract gate registration', async () => {
    const registry = new TelemetryRegistry({
      service: 'svc',
      module: 'server',
      environment: 'test',
      flushIntervalMs: 60_000,
    });

    const orchestrator = new TelemetryCanaryOrchestrator({
      registry,
      rollbackConsecutiveFailures: 1,
    });

    orchestrator.addRequiredContractGate('runtime-contracts');
    const missingDecision = orchestrator.evaluate();
    expect(missingDecision.action).toBe('rollback');
    expect(
      missingDecision.failures.some(
        item =>
          item.reason === 'contract_gate_missing' &&
          item.gate === 'runtime-contracts',
      ),
    ).toBe(true);

    orchestrator.resetToCanary();
    orchestrator.setContractGate('runtime-contracts', true);
    const passingDecision = orchestrator.evaluate();
    expect(passingDecision.failures).toHaveLength(0);

    await registry.shutdown();
  });

  test('promotes when telemetry and contract gates stay healthy', async () => {
    const registry = new TelemetryRegistry({
      service: 'svc',
      module: 'server',
      environment: 'test',
      flushIntervalMs: 60_000,
    });
    await registry.register({
      name: 'memory',
      async emit() {
        // noop
      },
    });

    const onPromote = rs.fn();
    const orchestrator = new TelemetryCanaryOrchestrator({
      registry,
      minConsecutiveHealthyEvaluations: 2,
      requiredContractGates: ['contracts'],
      onPromote,
    });
    orchestrator.setContractGate('contracts', true);

    expect(orchestrator.evaluate().action).toBe('hold');
    const decision = orchestrator.evaluate();
    expect(decision.action).toBe('promote');
    expect(decision.state).toBe('promoted');
    expect(onPromote).toHaveBeenCalledTimes(1);

    await registry.shutdown();
  });

  test('rolls back after consecutive contract gate failures', async () => {
    const registry = new TelemetryRegistry({
      service: 'svc',
      module: 'server',
      environment: 'test',
      flushIntervalMs: 60_000,
    });

    const onRollback = rs.fn();
    const orchestrator = new TelemetryCanaryOrchestrator({
      registry,
      requiredContractGates: ['contracts'],
      rollbackConsecutiveFailures: 2,
      onRollback,
    });
    orchestrator.setContractGate('contracts', false, 'schema drift');

    expect(orchestrator.evaluate().action).toBe('hold');
    const decision = orchestrator.evaluate();
    expect(decision.action).toBe('rollback');
    expect(decision.state).toBe('rolled_back');
    expect(
      decision.failures.some(item => item.reason === 'contract_gate_failed'),
    ).toBe(true);
    expect(onRollback).toHaveBeenCalledTimes(1);

    await registry.shutdown();
  });

  test('rolls back immediately when queue dropped budget is exceeded', async () => {
    const registry = new TelemetryRegistry({
      service: 'svc',
      module: 'server',
      environment: 'test',
      maxQueueSize: 2,
      flushIntervalMs: 60_000,
    });
    registry.enqueue(createEnvelope({ name: 'a' }));
    registry.enqueue(createEnvelope({ name: 'b' }));
    registry.enqueue(createEnvelope({ name: 'c' }));

    const orchestrator = new TelemetryCanaryOrchestrator({
      registry,
      maxTotalDropped: 0,
      rollbackConsecutiveFailures: 1,
    });
    const decision = orchestrator.evaluate();
    expect(decision.action).toBe('rollback');
    expect(
      decision.failures.some(item => item.reason === 'queue_dropped'),
    ).toBe(true);

    await registry.shutdown();
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
