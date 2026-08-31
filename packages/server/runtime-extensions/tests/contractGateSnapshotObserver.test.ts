import fs from 'fs';
import os from 'os';
import path from 'path';
import type { GateSnapshot } from '../src/contract-gate-snapshot-store';
import { ContractGateSnapshotObserver } from '../src/contractGateSnapshotObserver';
import { TelemetryHealthMonitor, TelemetryRegistry } from '../src/telemetry';

const makeTempDir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'modern-contract-gate-observer-'));

describe('contract gate observer', () => {
  test('syncs gate snapshot and updates health observations', async () => {
    const dir = makeTempDir();
    const snapshotPath = path.join(dir, 'contract-gates.json');

    const registry = new TelemetryRegistry({
      service: 'svc',
      module: 'server',
      environment: 'test',
      flushIntervalMs: 60_000,
    });
    const monitor = new TelemetryHealthMonitor({
      registry,
      minConsecutiveFailedEvaluations: 1,
    });
    const observer = new ContractGateSnapshotObserver({
      monitor,
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

      await observer.start();
      const healthyDecision = monitor.evaluate();
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

      await observer.syncOnce();
      const rollbackDecision = monitor.evaluate();
      expect(rollbackDecision.state).toBe('unhealthy');
      expect(
        rollbackDecision.failures.some(
          item =>
            item.reason === 'contract_gate_failed' &&
            item.gate === 'release-candidate-contract-gates',
        ),
      ).toBe(true);
    } finally {
      observer.stop();
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
    const monitor = new TelemetryHealthMonitor({
      registry,
      minConsecutiveFailedEvaluations: 1,
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

    const observer = new ContractGateSnapshotObserver({
      monitor,
      gateSnapshotPath: snapshotPath,
      gateStaleAfterMs: 1_000,
    });

    try {
      await observer.syncOnce();
      const decision = monitor.evaluate();
      expect(decision.state).toBe('unhealthy');
      expect(
        decision.failures.some(
          item =>
            item.reason === 'contract_gate_failed' &&
            item.gate === 'module-onboarding-certification-gates',
        ),
      ).toBe(true);
    } finally {
      observer.stop();
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
    const monitor = new TelemetryHealthMonitor({
      registry,
      minConsecutiveFailedEvaluations: 1,
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

    const observer = new ContractGateSnapshotObserver({
      monitor,
      gateSnapshotPath: snapshotPath,
      gateStaleAfterMs: 1_000,
    });

    try {
      await observer.syncOnce();
      expect(monitor.evaluate().failures).toHaveLength(0);

      now += 1_001;
      await observer.syncOnce();

      const decision = monitor.evaluate();
      expect(decision.state).toBe('unhealthy');
      expect(
        decision.failures.some(
          item =>
            item.reason === 'contract_gate_failed' &&
            item.gate === 'module-onboarding-certification-gates',
        ),
      ).toBe(true);
    } finally {
      Date.now = originalDateNow;
      observer.stop();
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
    const monitor = new TelemetryHealthMonitor({
      registry,
      minConsecutiveFailedEvaluations: 1,
    });
    const snapshotResolvers: Array<
      (snapshot: GateSnapshot | undefined) => void
    > = [];
    const observer = new ContractGateSnapshotObserver({
      monitor,
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
      const olderSync = observer.syncOnce();
      const newerSync = observer.syncOnce();
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
      expect(monitor.evaluate().failures).toHaveLength(0);

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

      expect(monitor.evaluate().failures).toHaveLength(0);
    } finally {
      observer.stop();
      await registry.shutdown();
    }
  });

  test('clears previously applied gate failures when snapshots omit them', async () => {
    const dir = makeTempDir();
    const snapshotPath = path.join(dir, 'contract-gates.json');

    const registry = new TelemetryRegistry({
      service: 'svc',
      module: 'server',
      environment: 'test',
      flushIntervalMs: 60_000,
    });
    const monitor = new TelemetryHealthMonitor({
      registry,
      minConsecutiveFailedEvaluations: 1,
    });
    const observer = new ContractGateSnapshotObserver({
      monitor,
      gateSnapshotPath: snapshotPath,
      gateStaleAfterMs: 60_000,
    });

    try {
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
                updatedAt: now,
              },
            },
          },
          null,
          2,
        ),
      );

      await observer.syncOnce();
      expect(
        monitor
          .evaluate()
          .failures.some(
            item =>
              item.reason === 'contract_gate_failed' &&
              item.gate === 'runtime-mf-fallback-health',
          ),
      ).toBe(true);

      fs.writeFileSync(
        snapshotPath,
        JSON.stringify(
          {
            schemaVersion: 1,
            updatedAt: Date.now(),
            gates: {},
          },
          null,
          2,
        ),
      );

      await observer.syncOnce();
      expect(monitor.evaluate().failures).toHaveLength(0);
    } finally {
      observer.stop();
      await registry.shutdown();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('observes recovered runtime fallback gates after expiry window', async () => {
    const dir = makeTempDir();
    const snapshotPath = path.join(dir, 'contract-gates.json');

    const registry = new TelemetryRegistry({
      service: 'svc',
      module: 'server',
      environment: 'test',
      flushIntervalMs: 60_000,
    });
    const monitor = new TelemetryHealthMonitor({
      registry,
      minConsecutiveFailedEvaluations: 1,
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

    const observer = new ContractGateSnapshotObserver({
      monitor,
      gateSnapshotPath: snapshotPath,
      gateStaleAfterMs: 60_000,
    });

    try {
      await observer.syncOnce();
      const decision = monitor.evaluate();
      expect(decision.failures).toHaveLength(0);
    } finally {
      observer.stop();
      await registry.shutdown();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
