import fs from 'fs';
import os from 'os';
import path from 'path';
import type { GateSnapshot } from '../src/contract-gate-snapshot-store';
import { ContractGateAutopilot } from '../src/contractGateAutopilot';
import {
  TelemetryCanaryOrchestrator,
  TelemetryRegistry,
} from '../src/telemetry';

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

  test('marks unchanged gate snapshots stale after the stale window elapses', async () => {
    const dir = makeTempDir();
    const snapshotPath = path.join(dir, 'contract-gates.json');
    const originalDateNow = Date.now;
    let now = 1_000_000;
    Date.now = () => now;

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
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          updatedAt: now,
          gates: {
            'module-onboarding-certification-gates': {
              passed: true,
              updatedAt: now,
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
      expect(orchestrator.evaluate().failures).toHaveLength(0);

      now += 1_001;
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
      Date.now = originalDateNow;
      autopilot.stop();
      await registry.shutdown();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('ignores older snapshot reads that resolve after newer syncs', async () => {
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
    const snapshotResolvers: Array<
      (snapshot: GateSnapshot | undefined) => void
    > = [];
    const autopilot = new ContractGateAutopilot({
      orchestrator,
      gateSnapshotStore: {
        name: 'deferred',
        readSnapshot: () =>
          new Promise<GateSnapshot | undefined>(resolve => {
            snapshotResolvers.push(resolve);
          }),
        writeSnapshot: async () => {},
      },
      gateStaleAfterMs: 0,
    });

    try {
      const olderSync = autopilot.syncOnce();
      const newerSync = autopilot.syncOnce();
      expect(snapshotResolvers).toHaveLength(2);

      snapshotResolvers[1]?.({
        schemaVersion: 1,
        updatedAt: 2_000,
        gates: {
          'module-onboarding-certification-gates': {
            passed: true,
            updatedAt: 2_000,
          },
        },
      });
      await newerSync;
      expect(orchestrator.evaluate().failures).toHaveLength(0);

      snapshotResolvers[0]?.({
        schemaVersion: 1,
        updatedAt: 1_000,
        gates: {
          'module-onboarding-certification-gates': {
            passed: false,
            reason: 'older snapshot resolved late',
            updatedAt: 1_000,
          },
        },
      });
      await olderSync;

      expect(orchestrator.evaluate().failures).toHaveLength(0);
    } finally {
      autopilot.stop();
      await registry.shutdown();
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
