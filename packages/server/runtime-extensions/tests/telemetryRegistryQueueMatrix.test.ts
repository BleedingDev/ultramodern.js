import {
  type TelemetryEnvelope,
  type TelemetryExporter,
  TelemetryRegistry,
  type TelemetrySloAlert,
} from '../src/telemetry';

const createEnvelope = (
  partial: Partial<TelemetryEnvelope> = {},
): TelemetryEnvelope => ({
  timestamp: Date.now(),
  service: 'svc',
  module: 'server',
  environment: 'test',
  signalType: 'metric',
  name: 'server.handle.request',
  value: 1,
  unit: 'count',
  ...partial,
});

const createRegistry = (
  options: Partial<ConstructorParameters<typeof TelemetryRegistry>[0]> = {},
) =>
  new TelemetryRegistry({
    service: 'svc',
    module: 'server',
    environment: 'test',
    flushIntervalMs: 60_000,
    maxBatchSize: 100,
    ...options,
  });

const createMemoryExporter = (
  batches: TelemetryEnvelope[][],
): TelemetryExporter => ({
  name: 'memory',
  emit(batch) {
    batches.push([...batch]);
  },
});

describe('telemetry registry queue matrix', () => {
  test.each([
    {
      name: 'below-threshold drops remain window-scoped across flushes',
      dropsPerWindow: [1, 1],
      expectedDropAlertValues: [],
      expectedDropAlertTotals: [],
    },
    {
      name: 'threshold drops alert once per window with lifetime totals attached',
      dropsPerWindow: [2, 2],
      expectedDropAlertValues: [2, 2],
      expectedDropAlertTotals: [2, 4],
    },
  ])('$name', async ({
    dropsPerWindow,
    expectedDropAlertValues,
    expectedDropAlertTotals,
  }) => {
    const alerts: TelemetrySloAlert[] = [];
    const batches: TelemetryEnvelope[][] = [];
    const registry = createRegistry({
      maxQueueSize: 2,
      slo: {
        queueUtilizationWarnThreshold: 1,
        queueDroppedWarnThreshold: 2,
        alertCooldownMs: 0,
        onAlert(alert) {
          alerts.push(alert);
        },
      },
    });
    await registry.register(createMemoryExporter(batches));

    let totalDropped = 0;
    for (const [windowIndex, dropCount] of dropsPerWindow.entries()) {
      for (let index = 0; index < 2 + dropCount; index++) {
        registry.enqueue(
          createEnvelope({
            name: `window.${windowIndex}.event.${index}`,
          }),
        );
      }

      totalDropped += dropCount;
      expect(registry.getQueueStats()).toEqual({
        depth: 2,
        capacity: 2,
        utilization: 1,
        pendingDropped: dropCount,
        totalDropped,
      });

      await registry.flush();
      expect(registry.getQueueStats()).toEqual({
        depth: 0,
        capacity: 2,
        utilization: 0,
        pendingDropped: 0,
        totalDropped,
      });
      expect(batches).toHaveLength(windowIndex + 1);
      expect(batches[windowIndex]).toHaveLength(5);
    }

    const emitted = batches.flat();
    expect(
      emitted
        .filter(item => item.name === 'telemetry.queue.dropped')
        .map(item => item.value),
    ).toEqual(dropsPerWindow);
    expect(
      emitted
        .filter(item => item.name === 'telemetry.queue.depth')
        .map(item => item.value),
    ).toEqual([2, 2]);
    expect(
      emitted
        .filter(item => item.name === 'telemetry.queue.utilization')
        .map(item => item.value),
    ).toEqual([1, 1]);

    const utilizationAlerts = alerts.filter(
      alert => alert.type === 'queue.utilization',
    );
    expect(utilizationAlerts.length).toBeGreaterThan(0);
    expect(utilizationAlerts.every(alert => alert.value === 1)).toBe(true);

    const dropAlerts = alerts.filter(alert => alert.type === 'queue.drop');
    expect(dropAlerts.map(alert => alert.value)).toEqual(
      expectedDropAlertValues,
    );
    expect(dropAlerts.map(alert => alert.totalDropped)).toEqual(
      expectedDropAlertTotals,
    );
    expect(dropAlerts.every(alert => alert.threshold === 2)).toBe(true);

    await registry.shutdown();
  });

  test('aggregates exporter health across successful and failed emitters', async () => {
    const batches: TelemetryEnvelope[][] = [];
    const registry = createRegistry({ maxQueueSize: 4 });
    const failingExporter = {
      name: 'failing',
      async emit() {
        throw new Error('export failed');
      },
    } satisfies TelemetryExporter;

    await registry.register(createMemoryExporter(batches));
    await registry.register(failingExporter);

    registry.enqueue(createEnvelope({ name: 'health.sample' }));
    await registry.flush();

    const healthByName = new Map(
      registry.getExporterHealth().map(item => [item.name, item]),
    );
    expect(healthByName.get('memory')).toMatchObject({
      name: 'memory',
      healthy: true,
      failures: 0,
    });
    expect(healthByName.get('memory')?.lastSuccessAt).toEqual(
      expect.any(Number),
    );
    expect(healthByName.get('failing')).toMatchObject({
      name: 'failing',
      healthy: false,
      failures: 1,
      lastError: 'export failed',
    });
    expect(healthByName.get('failing')?.lastFailureAt).toEqual(
      expect.any(Number),
    );
    expect(batches).toHaveLength(1);
    expect(batches[0].some(item => item.name === 'health.sample')).toBe(true);

    await registry.shutdown();
  });

  test('clamps NaN queue utilization SLO threshold before alerting', async () => {
    const alerts: TelemetrySloAlert[] = [];
    const registry = createRegistry({
      maxQueueSize: 2,
      slo: {
        queueUtilizationWarnThreshold: Number.NaN,
        alertCooldownMs: 0,
        onAlert(alert) {
          alerts.push(alert);
        },
      },
    });

    registry.enqueue(createEnvelope({ name: 'half-full' }));
    expect(registry.getQueueStats()).toEqual({
      depth: 1,
      capacity: 2,
      utilization: 0.5,
      pendingDropped: 0,
      totalDropped: 0,
    });
    expect(alerts.filter(alert => alert.type === 'queue.utilization')).toEqual(
      [],
    );

    registry.enqueue(createEnvelope({ name: 'full' }));
    const utilizationAlerts = alerts.filter(
      alert => alert.type === 'queue.utilization',
    );
    expect(utilizationAlerts).toHaveLength(1);
    expect(utilizationAlerts[0]).toMatchObject({
      type: 'queue.utilization',
      value: 1,
      threshold: 1,
      queueDepth: 2,
      queueCapacity: 2,
      queueUtilization: 1,
      totalDropped: 0,
    });

    await registry.shutdown();
  });
});
