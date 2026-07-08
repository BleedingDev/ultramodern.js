import {
  TelemetryCanaryOrchestrator,
  type TelemetryEnvelope,
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

  test('stays canary below the healthy threshold and promotes after consecutive healthy evaluations', async () => {
    const registry = new TelemetryRegistry({
      service: 'svc',
      module: 'server',
      environment: 'test',
      flushIntervalMs: 60_000,
    });
    const onEvaluate = rs.fn();
    const onPromote = rs.fn();
    const onRollback = rs.fn();
    const orchestrator = new TelemetryCanaryOrchestrator({
      registry,
      minConsecutiveHealthyEvaluations: 3,
      onEvaluate,
      onPromote,
      onRollback,
    });

    const first = orchestrator.evaluate();
    expect(first.action).toBe('hold');
    expect(first.state).toBe('canary');
    expect(first.consecutiveHealthy).toBe(1);

    const second = orchestrator.evaluate();
    expect(second.action).toBe('hold');
    expect(second.state).toBe('canary');
    expect(second.consecutiveHealthy).toBe(2);
    expect(onPromote).not.toHaveBeenCalled();

    const third = orchestrator.evaluate();
    expect(third.action).toBe('promote');
    expect(third.state).toBe('promoted');
    expect(third.consecutiveHealthy).toBe(3);

    expect(onEvaluate).toHaveBeenCalledTimes(3);
    expect(onEvaluate).toHaveBeenNthCalledWith(1, first);
    expect(onEvaluate).toHaveBeenNthCalledWith(2, second);
    expect(onEvaluate).toHaveBeenNthCalledWith(3, third);
    expect(onPromote).toHaveBeenCalledTimes(1);
    expect(onPromote).toHaveBeenCalledWith(third);
    expect(onRollback).not.toHaveBeenCalled();

    await registry.shutdown();
  });

  test('rolls back after consecutive failures and stays rolled back until reset', async () => {
    const registry = new TelemetryRegistry({
      service: 'svc',
      module: 'server',
      environment: 'test',
      flushIntervalMs: 60_000,
    });
    const onEvaluate = rs.fn();
    const onPromote = rs.fn();
    const onRollback = rs.fn();
    const orchestrator = new TelemetryCanaryOrchestrator({
      registry,
      minConsecutiveHealthyEvaluations: 1,
      rollbackConsecutiveFailures: 2,
      requiredContractGates: ['contracts'],
      onEvaluate,
      onPromote,
      onRollback,
    });

    orchestrator.setContractGate('contracts', false, 'schema drift');

    const firstFailure = orchestrator.evaluate();
    expect(firstFailure.action).toBe('hold');
    expect(firstFailure.state).toBe('canary');
    expect(firstFailure.consecutiveFailures).toBe(1);
    expect(onRollback).not.toHaveBeenCalled();

    const secondFailure = orchestrator.evaluate();
    expect(secondFailure.action).toBe('rollback');
    expect(secondFailure.state).toBe('rolled_back');
    expect(secondFailure.consecutiveFailures).toBe(2);
    expect(onRollback).toHaveBeenCalledTimes(1);
    expect(onRollback).toHaveBeenCalledWith(secondFailure);

    orchestrator.setContractGate('contracts', true);
    const healthyWhileRolledBack = orchestrator.evaluate();
    expect(healthyWhileRolledBack.action).toBe('hold');
    expect(healthyWhileRolledBack.state).toBe('rolled_back');
    expect(healthyWhileRolledBack.consecutiveHealthy).toBe(1);
    expect(onPromote).not.toHaveBeenCalled();
    expect(onRollback).toHaveBeenCalledTimes(1);

    orchestrator.resetToCanary();
    expect(orchestrator.getStatusSnapshot().state).toBe('canary');

    const promotedAfterReset = orchestrator.evaluate();
    expect(promotedAfterReset.action).toBe('promote');
    expect(promotedAfterReset.state).toBe('promoted');
    expect(onEvaluate).toHaveBeenCalledTimes(4);
    expect(onPromote).toHaveBeenCalledTimes(1);
    expect(onPromote).toHaveBeenCalledWith(promotedAfterReset);

    await registry.shutdown();
  });

  test('blocks promotion until required contract gates pass', async () => {
    const registry = new TelemetryRegistry({
      service: 'svc',
      module: 'server',
      environment: 'test',
      flushIntervalMs: 60_000,
    });
    const onPromote = rs.fn();
    const orchestrator = new TelemetryCanaryOrchestrator({
      registry,
      minConsecutiveHealthyEvaluations: 1,
      rollbackConsecutiveFailures: 10,
      requiredContractGates: ['contracts', 'runtime'],
      onPromote,
    });

    orchestrator.setContractGate('contracts', true);
    const missingGateDecision = orchestrator.evaluate();
    expect(missingGateDecision.action).toBe('hold');
    expect(missingGateDecision.state).toBe('canary');
    expect(missingGateDecision.consecutiveHealthy).toBe(0);
    expect(missingGateDecision.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: 'contract_gate_missing',
          gate: 'runtime',
        }),
      ]),
    );
    expect(onPromote).not.toHaveBeenCalled();

    orchestrator.setContractGate('runtime', false, 'runtime contract failed');
    const failedGateDecision = orchestrator.evaluate();
    expect(failedGateDecision.action).toBe('hold');
    expect(failedGateDecision.state).toBe('canary');
    expect(failedGateDecision.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: 'contract_gate_failed',
          gate: 'runtime',
        }),
      ]),
    );
    expect(onPromote).not.toHaveBeenCalled();

    orchestrator.setContractGate('runtime', true);
    const passingGateDecision = orchestrator.evaluate();
    expect(passingGateDecision.action).toBe('promote');
    expect(passingGateDecision.state).toBe('promoted');
    expect(passingGateDecision.failures).toHaveLength(0);
    expect(onPromote).toHaveBeenCalledTimes(1);
    expect(onPromote).toHaveBeenCalledWith(passingGateDecision);

    await registry.shutdown();
  });

  test('observer hook failures do not escape or block later hooks', async () => {
    const promotingRegistry = new TelemetryRegistry({
      service: 'svc',
      module: 'server',
      environment: 'test',
      flushIntervalMs: 60_000,
    });
    const onPromoteEvaluate = rs.fn(() => {
      throw new Error('evaluate promote failed');
    });
    const onPromote = rs.fn(() => {
      throw new Error('promote failed');
    });
    const promotingOrchestrator = new TelemetryCanaryOrchestrator({
      registry: promotingRegistry,
      minConsecutiveHealthyEvaluations: 1,
      onEvaluate: onPromoteEvaluate,
      onPromote,
    });
    let promotedDecision:
      | ReturnType<TelemetryCanaryOrchestrator['evaluate']>
      | undefined;

    expect(() => {
      promotedDecision = promotingOrchestrator.evaluate();
    }).not.toThrow();

    expect(promotedDecision?.action).toBe('promote');
    expect(promotedDecision?.state).toBe('promoted');
    expect(onPromoteEvaluate).toHaveBeenCalledTimes(1);
    expect(onPromote).toHaveBeenCalledTimes(1);

    const rollbackRegistry = new TelemetryRegistry({
      service: 'svc',
      module: 'server',
      environment: 'test',
      flushIntervalMs: 60_000,
    });
    const onRollbackEvaluate = rs.fn(() => {
      throw new Error('evaluate rollback failed');
    });
    const onRollback = rs.fn(() => {
      throw new Error('rollback failed');
    });
    const rollbackOrchestrator = new TelemetryCanaryOrchestrator({
      registry: rollbackRegistry,
      rollbackConsecutiveFailures: 1,
      requiredContractGates: ['contracts'],
      onEvaluate: onRollbackEvaluate,
      onRollback,
    });
    let rollbackDecision:
      | ReturnType<TelemetryCanaryOrchestrator['evaluate']>
      | undefined;

    expect(() => {
      rollbackDecision = rollbackOrchestrator.evaluate();
    }).not.toThrow();

    expect(rollbackDecision?.action).toBe('rollback');
    expect(rollbackDecision?.state).toBe('rolled_back');
    expect(onRollbackEvaluate).toHaveBeenCalledTimes(1);
    expect(onRollback).toHaveBeenCalledTimes(1);

    await promotingRegistry.shutdown();
    await rollbackRegistry.shutdown();
  });
});
