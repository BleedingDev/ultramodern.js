import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  persistRuntimeFallbackContractGateInWorker,
  type RuntimeFallbackWorkerLanePayload,
} from '../src/libs/runtimeFallbackWorkerLane';

const makeTempDir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'modern-runtime-worker-lane-'));

describe('runtime fallback worker lane', () => {
  test('persists gate snapshot in worker lane when enabled', async () => {
    const dir = makeTempDir();
    const snapshotPath = path.join(dir, '.modern/contract-gates.json');

    try {
      const payload: RuntimeFallbackWorkerLanePayload = {
        snapshotPath,
        gateName: 'runtime-mf-fallback-health',
        failureHoldMs: 5_000,
        schemaVersion: 1,
        payload: {
          reason: 'remote_load_failed',
          phase: 'load',
          appName: 'crm-shell',
          entry: 'https://erp.example.com/remoteEntry.js',
        },
      };

      const result = await persistRuntimeFallbackContractGateInWorker(payload, {
        enabled: true,
        timeoutMs: 2_000,
      });
      expect(result.ok).toBe(true);
      expect(fs.existsSync(snapshotPath)).toBe(true);

      const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) as {
        gates?: Record<string, any>;
      };
      expect(snapshot.gates?.['runtime-mf-fallback-health']?.passed).toBe(
        false,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('returns disabled result when worker lane is not enabled', async () => {
    const dir = makeTempDir();
    const payload: RuntimeFallbackWorkerLanePayload = {
      snapshotPath: path.join(dir, '.modern/contract-gates.json'),
      gateName: 'runtime-mf-fallback-health',
      failureHoldMs: 5_000,
      schemaVersion: 1,
      payload: {
        reason: 'remote_load_failed',
      },
    };

    try {
      const result = await persistRuntimeFallbackContractGateInWorker(payload, {
        enabled: false,
        timeoutMs: 250,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('worker_lane_disabled');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
