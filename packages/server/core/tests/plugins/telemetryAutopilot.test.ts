import fs from 'fs';
import os from 'os';
import path from 'path';
import { createDefaultPlugins } from '../../src/plugins';
import { createServerBase } from '../../src/serverBase';
import { getDefaultAppContext, getDefaultConfig } from '../helpers';

const makeTempDir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'modern-telemetry-autopilot-'));

describe('telemetry autopilot runtime signal', () => {
  test('accepts runtime fallback signal and persists gate snapshot', async () => {
    const tempDir = makeTempDir();
    const snapshotPath = path.join(tempDir, '.modern/contract-gates.json');

    try {
      const config = getDefaultConfig();
      config.server = {
        telemetry: {
          enabled: true,
          canary: {
            enabled: true,
            rollbackConsecutiveFailures: 1,
            autopilot: {
              enabled: true,
              gateSnapshotPath: snapshotPath,
              pollIntervalMs: 20,
              gateStaleAfterMs: 60_000,
              runtimeFallbackSignal: {
                enabled: true,
                endpoint: '/_modern/contract-gates/runtime-fallback',
                gateName: 'runtime-mf-fallback-health',
                failureHoldMs: 5_000,
                maxBodyBytes: 4_096,
              },
            },
          },
        },
      } as any;

      const server = createServerBase({
        config,
        pwd: tempDir,
        appContext: getDefaultAppContext(),
      });

      server.addPlugins([
        ...createDefaultPlugins({
          logger: false,
        }),
      ]);

      await server.init();

      const response = await server.request(
        '/_modern/contract-gates/runtime-fallback',
        {
          method: 'POST',
          headers: new Headers({
            'content-type': 'application/json',
          }),
          body: JSON.stringify({
            reason: 'remote_load_failed',
            phase: 'load',
            appName: 'dashboard',
            entry: 'https://remote.example.com/remoteEntry.js',
          }),
        },
        {},
      );

      expect(response.status).toBe(202);
      expect(fs.existsSync(snapshotPath)).toBe(true);

      const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) as {
        gates?: Record<string, any>;
      };
      const gate = snapshot.gates?.['runtime-mf-fallback-health'];
      expect(gate).toBeTruthy();
      expect(gate.passed).toBe(false);
      expect(String(gate.reason)).toContain(
        'runtime_fallback:remote_load_failed',
      );
      expect(typeof gate.expiresAt).toBe('number');
      expect(gate.expiresAt).toBeGreaterThan(Date.now());
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('rejects oversized runtime fallback signal payload', async () => {
    const tempDir = makeTempDir();
    const snapshotPath = path.join(tempDir, '.modern/contract-gates.json');

    try {
      const config = getDefaultConfig();
      config.server = {
        telemetry: {
          enabled: true,
          canary: {
            enabled: true,
            rollbackConsecutiveFailures: 1,
            autopilot: {
              enabled: true,
              gateSnapshotPath: snapshotPath,
              runtimeFallbackSignal: {
                enabled: true,
                endpoint: '/_modern/contract-gates/runtime-fallback',
                maxBodyBytes: 16,
              },
            },
          },
        },
      } as any;

      const server = createServerBase({
        config,
        pwd: tempDir,
        appContext: getDefaultAppContext(),
      });
      server.addPlugins([
        ...createDefaultPlugins({
          logger: false,
        }),
      ]);

      await server.init();

      const response = await server.request(
        '/_modern/contract-gates/runtime-fallback',
        {
          method: 'POST',
          headers: new Headers({
            'content-type': 'application/json',
          }),
          body: JSON.stringify({
            reason: 'x'.repeat(2_048),
          }),
        },
        {},
      );

      expect(response.status).toBe(413);
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };
      expect(payload.ok).toBe(false);
      expect(String(payload.error)).toContain('payload too large');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
