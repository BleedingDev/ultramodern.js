import fs from 'fs';
import os from 'os';
import path from 'path';
import { ContractGateAutopilot } from '../src/libs/contractGateAutopilot';
import {
  TelemetryCanaryOrchestrator,
  TelemetryRegistry,
} from '../src/libs/telemetry';

const makeTempDir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'modern-contract-gate-autopilot-'));

describe('contract gate autopilot', () => {
  test('syncs gate snapshot and updates canary decisions automatically', async () => {
    const dir = makeTempDir();
    const snapshotPath = path.join(dir, 'contract-gates.json');

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
    const autopilot = new ContractGateAutopilot({
      orchestrator,
      gateSnapshotPath: snapshotPath,
      pollIntervalMs: 50,
      gateStaleAfterMs: 60_000,
    });

    try {
      fs.writeFileSync(
        snapshotPath,
        JSON.stringify(
          {
            schemaVersion: 1,
            updatedAt: Date.now(),
            gates: {
              'release-candidate-contract-gates': {
                passed: true,
                updatedAt: Date.now(),
              },
            },
          },
          null,
          2,
        ),
      );

      await autopilot.start();
      const healthyDecision = orchestrator.evaluate();
      expect(healthyDecision.failures).toHaveLength(0);

      fs.writeFileSync(
        snapshotPath,
        JSON.stringify(
          {
            schemaVersion: 1,
            updatedAt: Date.now(),
            gates: {
              'release-candidate-contract-gates': {
                passed: false,
                reason: 'runtime compatibility drift',
                updatedAt: Date.now(),
              },
            },
          },
          null,
          2,
        ),
      );

      await autopilot.syncOnce();
      const rollbackDecision = orchestrator.evaluate();
      expect(rollbackDecision.action).toBe('rollback');
      expect(
        rollbackDecision.failures.some(
          item =>
            item.reason === 'contract_gate_failed' &&
            item.gate === 'release-candidate-contract-gates',
        ),
      ).toBe(true);
    } finally {
      autopilot.stop();
      await registry.shutdown();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('fails stale gate snapshots without manual intervention', async () => {
    const dir = makeTempDir();
    const snapshotPath = path.join(dir, 'contract-gates.json');

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

    const staleUpdatedAt = Date.now() - 10_000;
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          updatedAt: staleUpdatedAt,
          gates: {
            'module-onboarding-certification-gates': {
              passed: true,
              updatedAt: staleUpdatedAt,
            },
          },
        },
        null,
        2,
      ),
    );

    const autopilot = new ContractGateAutopilot({
      orchestrator,
      gateSnapshotPath: snapshotPath,
      gateStaleAfterMs: 1_000,
    });

    try {
      await autopilot.syncOnce();
      const decision = orchestrator.evaluate();
      expect(decision.action).toBe('rollback');
      expect(
        decision.failures.some(
          item =>
            item.reason === 'contract_gate_failed' &&
            item.gate === 'module-onboarding-certification-gates',
        ),
      ).toBe(true);
    } finally {
      autopilot.stop();
      await registry.shutdown();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('auto-recovers runtime fallback gates after expiry window', async () => {
    const dir = makeTempDir();
    const snapshotPath = path.join(dir, 'contract-gates.json');

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
    const now = Date.now();
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          updatedAt: now,
          gates: {
            'runtime-mf-fallback-health': {
              passed: false,
              reason: 'runtime_fallback:remote_load_failed',
              updatedAt: now - 1_000,
              expiresAt: now - 100,
            },
          },
        },
        null,
        2,
      ),
    );

    const autopilot = new ContractGateAutopilot({
      orchestrator,
      gateSnapshotPath: snapshotPath,
      gateStaleAfterMs: 60_000,
    });

    try {
      await autopilot.syncOnce();
      const decision = orchestrator.evaluate();
      expect(decision.failures).toHaveLength(0);
    } finally {
      autopilot.stop();
      await registry.shutdown();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
