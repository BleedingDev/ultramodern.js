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
});
