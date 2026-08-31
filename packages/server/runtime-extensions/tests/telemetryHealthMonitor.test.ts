import {
  type TelemetryEnvelope,
  TelemetryHealthMonitor,
  TelemetryRegistry,
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
  value: 10,
  unit: 'ms',
  ...partial,
});

const createRegistry = (maxQueueSize = 1_000) =>
  new TelemetryRegistry({
    service: 'svc',
    module: 'server',
    environment: 'test',
    maxQueueSize,
    flushIntervalMs: 60_000,
  });

describe('telemetry health monitor', () => {
  test('reports hysteretic health transitions without deployment actions', async () => {
    const registry = createRegistry();
    const onEvaluate = rs.fn();
    const onTransition = rs.fn();
    const monitor = new TelemetryHealthMonitor({
      registry,
      minConsecutiveHealthyEvaluations: 2,
      minConsecutiveFailedEvaluations: 2,
      requiredContractGates: ['contracts'],
      onEvaluate,
      onTransition,
    });

    monitor.setContractGate('contracts', false, 'schema drift');
    const firstFailure = monitor.evaluate();
    const unhealthy = monitor.evaluate();
    const stillUnhealthy = monitor.evaluate();

    expect(firstFailure).toMatchObject({
      state: 'pending',
      transition: 'none',
      consecutiveFailures: 1,
    });
    expect(unhealthy).toMatchObject({
      state: 'unhealthy',
      transition: 'became_unhealthy',
      consecutiveFailures: 2,
    });
    expect(stillUnhealthy).toMatchObject({
      state: 'unhealthy',
      transition: 'none',
      consecutiveFailures: 3,
    });

    monitor.setContractGate('contracts', true);
    const firstRecovery = monitor.evaluate();
    const recovered = monitor.evaluate();
    const stillHealthy = monitor.evaluate();

    expect(firstRecovery).toMatchObject({
      state: 'unhealthy',
      transition: 'none',
      consecutiveHealthy: 1,
    });
    expect(recovered).toMatchObject({
      state: 'healthy',
      transition: 'became_healthy',
      consecutiveHealthy: 2,
    });
    expect(stillHealthy).toMatchObject({
      state: 'healthy',
      transition: 'none',
      consecutiveHealthy: 3,
    });

    expect('action' in recovered).toBe(false);
    expect(JSON.stringify(recovered)).not.toMatch(/promot|rollback/i);
    expect(onEvaluate).toHaveBeenCalledTimes(6);
    expect(onTransition).toHaveBeenCalledTimes(2);
    expect(onTransition).toHaveBeenNthCalledWith(1, unhealthy);
    expect(onTransition).toHaveBeenNthCalledWith(2, recovered);

    await registry.shutdown();
  });

  test('observes missing and failed required contract gates', async () => {
    const registry = createRegistry();
    const monitor = new TelemetryHealthMonitor({
      registry,
      minConsecutiveHealthyEvaluations: 1,
      minConsecutiveFailedEvaluations: 1,
    });

    monitor.addRequiredContractGate('runtime-contracts');
    const missing = monitor.evaluate();
    expect(missing.state).toBe('unhealthy');
    expect(missing.failures).toContainEqual(
      expect.objectContaining({
        reason: 'contract_gate_missing',
        gate: 'runtime-contracts',
      }),
    );

    monitor.setContractGate('runtime-contracts', false, 'incompatible schema');
    const failed = monitor.evaluate();
    expect(failed.failures).toContainEqual(
      expect.objectContaining({
        reason: 'contract_gate_failed',
        gate: 'runtime-contracts',
        message: 'incompatible schema',
      }),
    );

    monitor.setContractGate('runtime-contracts', true);
    const healthy = monitor.evaluate();
    expect(healthy).toMatchObject({
      state: 'healthy',
      transition: 'became_healthy',
      failures: [],
    });

    await registry.shutdown();
  });

  test('observes telemetry queue drops', async () => {
    const registry = createRegistry(2);
    registry.enqueue(createEnvelope({ name: 'a' }));
    registry.enqueue(createEnvelope({ name: 'b' }));
    registry.enqueue(createEnvelope({ name: 'c' }));

    const monitor = new TelemetryHealthMonitor({
      registry,
      maxTotalDropped: 0,
      minConsecutiveFailedEvaluations: 1,
    });
    const evaluation = monitor.evaluate();

    expect(evaluation).toMatchObject({
      state: 'unhealthy',
      transition: 'became_unhealthy',
    });
    expect(evaluation.failures).toContainEqual(
      expect.objectContaining({ reason: 'queue_dropped' }),
    );

    await registry.shutdown();
  });

  test('isolates health observer failures from the server path', async () => {
    const registry = createRegistry();
    const onEvaluate = rs.fn(() => {
      throw new Error('evaluate observer failed');
    });
    const onTransition = rs.fn(() => {
      throw new Error('transition observer failed');
    });
    const monitor = new TelemetryHealthMonitor({
      registry,
      minConsecutiveHealthyEvaluations: 1,
      onEvaluate,
      onTransition,
    });

    let evaluation: ReturnType<TelemetryHealthMonitor['evaluate']> | undefined;
    expect(() => {
      evaluation = monitor.evaluate();
    }).not.toThrow();
    expect(evaluation).toMatchObject({
      state: 'healthy',
      transition: 'became_healthy',
    });
    expect(onEvaluate).toHaveBeenCalledTimes(1);
    expect(onTransition).toHaveBeenCalledTimes(1);

    await registry.shutdown();
  });
});
