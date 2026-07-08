import { createDefaultPlugins, createServerBase } from '@modern-js/server-core';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { injectTelemetryPlugin } from '../src/telemetry';
import { getDefaultAppContext, getDefaultConfig } from './helpers';

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
                auth: {
                  expectedValue: 'accept-signal-token',
                },
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
        injectTelemetryPlugin(),
      ]);

      await server.init();

      const response = await server.request(
        '/_modern/contract-gates/runtime-fallback',
        {
          method: 'POST',
          headers: new Headers({
            'content-type': 'application/json',
            'x-modernjs-runtime-signal-token': 'accept-signal-token',
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
                auth: {
                  expectedValue: 'oversize-signal-token',
                },
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
        injectTelemetryPlugin(),
      ]);

      await server.init();

      const response = await server.request(
        '/_modern/contract-gates/runtime-fallback',
        {
          method: 'POST',
          headers: new Headers({
            'content-type': 'application/json',
            'x-modernjs-runtime-signal-token': 'oversize-signal-token',
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

  test('requires runtime fallback auth token when configured', async () => {
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
                auth: {
                  enabled: true,
                  headerName: 'x-modernjs-runtime-signal-token',
                  expectedValue: 'top-secret-token',
                },
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
        injectTelemetryPlugin(),
      ]);

      await server.init();

      const rejected = await server.request(
        '/_modern/contract-gates/runtime-fallback',
        {
          method: 'POST',
          headers: new Headers({
            'content-type': 'application/json',
          }),
          body: JSON.stringify({
            reason: 'remote_load_failed',
            phase: 'load',
            appName: 'crm',
          }),
        },
        {},
      );
      expect(rejected.status).toBe(401);
      expect(fs.existsSync(snapshotPath)).toBe(false);

      const accepted = await server.request(
        '/_modern/contract-gates/runtime-fallback',
        {
          method: 'POST',
          headers: new Headers({
            'content-type': 'application/json',
            'x-modernjs-runtime-signal-token': 'top-secret-token',
          }),
          body: JSON.stringify({
            reason: 'remote_load_failed',
            phase: 'load',
            appName: 'crm',
          }),
        },
        {},
      );
      expect(accepted.status).toBe(202);
      expect(fs.existsSync(snapshotPath)).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('exposes runtime status endpoint and applies auth when runtime signal auth is enabled', async () => {
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
                auth: {
                  enabled: true,
                  headerName: 'x-modernjs-runtime-signal-token',
                  expectedValue: 'status-token',
                },
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
        injectTelemetryPlugin(),
      ]);

      await server.init();

      const unauthorized = await server.request(
        '/_modern/runtime/status',
        {
          method: 'GET',
          headers: new Headers(),
        },
        {},
      );
      expect(unauthorized.status).toBe(401);

      const authorized = await server.request(
        '/_modern/runtime/status',
        {
          method: 'GET',
          headers: new Headers({
            'x-modernjs-runtime-signal-token': 'status-token',
          }),
        },
        {},
      );
      expect(authorized.status).toBe(200);
      const payload = (await authorized.json()) as {
        ok?: boolean;
        telemetry?: { queueStats?: { capacity?: number } };
        canary?: { enabled?: boolean };
        runtimeFallbackSignal?: {
          enabled?: boolean;
          endpoint?: string;
          auth?: { enabled?: boolean };
        };
      };
      expect(payload.ok).toBe(true);
      expect(payload.telemetry?.queueStats?.capacity).toBeGreaterThan(0);
      expect(payload.canary?.enabled).toBe(true);
      expect(payload.runtimeFallbackSignal?.enabled).toBe(true);
      expect(payload.runtimeFallbackSignal?.endpoint).toBe(
        '/_modern/contract-gates/runtime-fallback',
      );
      expect(payload.runtimeFallbackSignal?.auth?.enabled).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('supports pluggable contract gate snapshot stateStore modules', async () => {
    const tempDir = makeTempDir();
    const defaultSnapshotPath = path.join(
      tempDir,
      '.modern/contract-gates.json',
    );
    const customSnapshotPath = path.join(tempDir, '.state-store/gates.json');
    const stateStoreModulePath = path.join(tempDir, 'gate-state-store.js');

    fs.writeFileSync(
      stateStoreModulePath,
      `'use strict';
const fs = require('fs');
const path = require('path');
exports.createContractGateSnapshotStore = ({ gateSnapshotPath, options }) => {
  const targetPath = options && typeof options.snapshotPath === 'string'
    ? options.snapshotPath
    : gateSnapshotPath;
  return {
    name: 'test-state-store',
    async readSnapshot() {
      if (!fs.existsSync(targetPath)) {
        return undefined;
      }
      return JSON.parse(fs.readFileSync(targetPath, 'utf8'));
    },
    async writeSnapshot(snapshot) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, JSON.stringify(snapshot, null, 2));
    },
  };
};
`,
      'utf8',
    );

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
              gateSnapshotPath: defaultSnapshotPath,
              stateStore: {
                module: stateStoreModulePath,
                options: {
                  snapshotPath: customSnapshotPath,
                },
              },
              runtimeFallbackSignal: {
                enabled: true,
                endpoint: '/_modern/contract-gates/runtime-fallback',
                auth: {
                  expectedValue: 'state-store-token',
                },
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
        injectTelemetryPlugin(),
      ]);

      await server.init();

      const response = await server.request(
        '/_modern/contract-gates/runtime-fallback',
        {
          method: 'POST',
          headers: new Headers({
            'content-type': 'application/json',
            'x-modernjs-runtime-signal-token': 'state-store-token',
          }),
          body: JSON.stringify({
            reason: 'remote_mount_failed',
            phase: 'mount',
            appName: 'crm',
          }),
        },
        {},
      );

      expect(response.status).toBe(202);
      expect(fs.existsSync(defaultSnapshotPath)).toBe(false);
      expect(fs.existsSync(customSnapshotPath)).toBe(true);

      const snapshot = JSON.parse(fs.readFileSync(customSnapshotPath, 'utf8'));
      expect(snapshot.gates?.['runtime-mf-fallback-health']?.passed).toBe(
        false,
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('autopilot path honors configured contract gate snapshot stateStore', async () => {
    const tempDir = makeTempDir();
    const defaultSnapshotPath = path.join(
      tempDir,
      '.modern/contract-gates.json',
    );
    const customSnapshotPath = path.join(tempDir, '.state-store/gates.json');
    const stateStoreModulePath = path.join(
      tempDir,
      'autopilot-gate-state-store.js',
    );
    const readMarkerPath = path.join(tempDir, '.state-store/read-marker.txt');
    const now = Date.now();

    fs.mkdirSync(path.dirname(customSnapshotPath), { recursive: true });
    fs.writeFileSync(
      customSnapshotPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          updatedAt: now,
          gates: {
            'state-store-autopilot-gate': {
              passed: false,
              reason: 'from configured stateStore',
              updatedAt: now,
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    fs.writeFileSync(
      stateStoreModulePath,
      `'use strict';
const fs = require('fs');
const path = require('path');
exports.createContractGateSnapshotStore = ({ gateSnapshotPath, options }) => {
  const targetPath = options && typeof options.snapshotPath === 'string'
    ? options.snapshotPath
    : gateSnapshotPath;
  const markerPath = options && typeof options.markerPath === 'string'
    ? options.markerPath
    : undefined;
  return {
    name: 'autopilot-test-state-store',
    async readSnapshot() {
      if (markerPath) {
        fs.mkdirSync(path.dirname(markerPath), { recursive: true });
        fs.appendFileSync(markerPath, targetPath + '\\n');
      }
      if (!fs.existsSync(targetPath)) {
        return undefined;
      }
      return JSON.parse(fs.readFileSync(targetPath, 'utf8'));
    },
    async writeSnapshot(snapshot) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, JSON.stringify(snapshot, null, 2));
    },
  };
};
`,
      'utf8',
    );

    try {
      const config = getDefaultConfig();
      config.server = {
        telemetry: {
          enabled: true,
          canary: {
            enabled: true,
            rollbackConsecutiveFailures: 1,
            contractGates: {
              'state-store-autopilot-gate': true,
            },
            autopilot: {
              enabled: true,
              gateSnapshotPath: defaultSnapshotPath,
              pollIntervalMs: 20,
              gateStaleAfterMs: 60_000,
              stateStore: {
                module: stateStoreModulePath,
                options: {
                  snapshotPath: customSnapshotPath,
                  markerPath: readMarkerPath,
                },
              },
              runtimeFallbackSignal: {
                auth: {
                  enabled: true,
                  expectedValue: 'state-store-status-token',
                },
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
        injectTelemetryPlugin(),
      ]);

      await server.init();

      expect(fs.existsSync(readMarkerPath)).toBe(true);
      expect(fs.readFileSync(readMarkerPath, 'utf8')).toContain(
        customSnapshotPath,
      );
      expect(fs.existsSync(defaultSnapshotPath)).toBe(false);

      const status = await server.request(
        '/_modern/runtime/status',
        {
          method: 'GET',
          headers: new Headers({
            'x-modernjs-runtime-signal-token': 'state-store-status-token',
          }),
        },
        {},
      );
      expect(status.status).toBe(200);
      const statusBody = await status.json();
      expect(statusBody.canary?.enabled).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('enforces runtime fallback trust policy before mutating gate snapshots', async () => {
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
                auth: {
                  expectedValue: 'trust-policy-token',
                },
                trustPolicy: {
                  allowedApps: ['crm-shell'],
                  allowedEntryOrigins: ['https://erp.example.com'],
                  expectedRuntimeDigests: {
                    'crm-shell': 'digest-crm-v1',
                  },
                  enforceRuntimeDigest: true,
                },
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
        injectTelemetryPlugin(),
      ]);

      await server.init();

      const untrustedApp = await server.request(
        '/_modern/contract-gates/runtime-fallback',
        {
          method: 'POST',
          headers: new Headers({
            'content-type': 'application/json',
            'x-modernjs-runtime-signal-token': 'trust-policy-token',
          }),
          body: JSON.stringify({
            reason: 'remote_load_failed',
            phase: 'load',
            appName: 'unknown-app',
            entry: 'https://erp.example.com/remoteEntry.js',
            runtimeDigest: 'digest-crm-v1',
          }),
        },
        {},
      );
      expect(untrustedApp.status).toBe(403);

      const digestMismatch = await server.request(
        '/_modern/contract-gates/runtime-fallback',
        {
          method: 'POST',
          headers: new Headers({
            'content-type': 'application/json',
            'x-modernjs-runtime-signal-token': 'trust-policy-token',
          }),
          body: JSON.stringify({
            reason: 'remote_load_failed',
            phase: 'load',
            appName: 'crm-shell',
            entry: 'https://erp.example.com/remoteEntry.js',
            runtimeDigest: 'digest-wrong',
          }),
        },
        {},
      );
      expect(digestMismatch.status).toBe(403);

      const trusted = await server.request(
        '/_modern/contract-gates/runtime-fallback',
        {
          method: 'POST',
          headers: new Headers({
            'content-type': 'application/json',
            'x-modernjs-runtime-signal-token': 'trust-policy-token',
          }),
          body: JSON.stringify({
            reason: 'remote_load_failed',
            phase: 'load',
            appName: 'crm-shell',
            entry: 'https://erp.example.com/remoteEntry.js',
            runtimeDigest: 'digest-crm-v1',
            metadata: {
              compatibility: {
                '@tanstack/react-router': '1.170.15',
              },
              remote: 'remote/Widget',
            },
          }),
        },
        {},
      );
      expect(trusted.status).toBe(202);

      const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) as {
        gates?: Record<string, any>;
      };
      expect(snapshot.gates?.['runtime-mf-fallback-health']?.passed).toBe(
        false,
      );
      expect(
        snapshot.gates?.['runtime-mf-fallback-health']?.metadata?.metadata
          ?.compatibility?.['@tanstack/react-router'],
      ).toBe('1.170.15');
      expect(
        snapshot.gates?.['runtime-mf-fallback-health']?.metadata?.metadata
          ?.remote,
      ).toBe('remote/Widget');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('deduplicates repeated fallback events and enforces rate limits per source window', async () => {
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
                auth: {
                  expectedValue: 'rate-limit-token',
                },
                trustPolicy: {
                  allowedApps: ['crm-shell'],
                  dedupeWindowMs: 60_000,
                  maxSignalsPerWindow: 1,
                  windowMs: 60_000,
                },
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
        injectTelemetryPlugin(),
      ]);

      await server.init();

      const payload = {
        reason: 'remote_mount_failed',
        phase: 'mount',
        appName: 'crm-shell',
        entry: 'https://erp.example.com/remoteEntry.js',
      };

      const first = await server.request(
        '/_modern/contract-gates/runtime-fallback',
        {
          method: 'POST',
          headers: new Headers({
            'content-type': 'application/json',
            'x-modernjs-runtime-signal-token': 'rate-limit-token',
          }),
          body: JSON.stringify(payload),
        },
        {},
      );
      expect(first.status).toBe(202);

      const duplicate = await server.request(
        '/_modern/contract-gates/runtime-fallback',
        {
          method: 'POST',
          headers: new Headers({
            'content-type': 'application/json',
            'x-modernjs-runtime-signal-token': 'rate-limit-token',
          }),
          body: JSON.stringify(payload),
        },
        {},
      );
      expect(duplicate.status).toBe(202);
      const duplicateBody = (await duplicate.json()) as {
        deduped?: boolean;
      };
      expect(duplicateBody.deduped).toBe(true);

      const secondUnique = await server.request(
        '/_modern/contract-gates/runtime-fallback',
        {
          method: 'POST',
          headers: new Headers({
            'content-type': 'application/json',
            'x-modernjs-runtime-signal-token': 'rate-limit-token',
          }),
          body: JSON.stringify({
            ...payload,
            reason: 'remote_load_failed',
          }),
        },
        {},
      );
      expect(secondUnique.status).toBe(429);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('keeps the runtime fallback signal endpoint disabled unless explicitly enabled', async () => {
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
              // no runtimeFallbackSignal config: the canary kill switch must
              // stay OFF by default.
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
        injectTelemetryPlugin(),
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
          }),
        },
        {},
      );

      expect(response.status).toBe(404);
      expect(fs.existsSync(snapshotPath)).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('refuses to enable the runtime fallback signal endpoint without an auth token', async () => {
    const tempDir = makeTempDir();
    const snapshotPath = path.join(tempDir, '.modern/contract-gates.json');

    try {
      const config = getDefaultConfig();
      config.server = {
        telemetry: {
          enabled: true,
          canary: {
            enabled: true,
            autopilot: {
              enabled: true,
              gateSnapshotPath: snapshotPath,
              runtimeFallbackSignal: {
                enabled: true,
                // no auth token configured: enabling must fail closed.
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
        injectTelemetryPlugin(),
      ]);

      await expect(server.init()).rejects.toThrow(
        /requires an auth token|auth\.expectedValue/,
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('rate limits cannot be reset by rotating payload identities', async () => {
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
                auth: {
                  expectedValue: 'rotation-token',
                },
                trustPolicy: {
                  dedupeWindowMs: 0,
                  maxSignalsPerWindow: 1,
                  windowMs: 60_000,
                },
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
        injectTelemetryPlugin(),
      ]);

      await server.init();

      const sendSignal = (appName: string) =>
        server.request(
          '/_modern/contract-gates/runtime-fallback',
          {
            method: 'POST',
            headers: new Headers({
              'content-type': 'application/json',
              'x-modernjs-runtime-signal-token': 'rotation-token',
            }),
            body: JSON.stringify({
              reason: 'remote_load_failed',
              phase: 'load',
              appName,
              entry: `https://${appName}.example.com/remoteEntry.js`,
            }),
          },
          {},
        );

      const first = await sendSignal('app-a');
      expect(first.status).toBe(202);

      // A rotated appName/entry pair used to mint a fresh rate-limit bucket;
      // the limiter is now keyed on connection identity instead.
      const rotated = await sendSignal('app-b');
      expect(rotated.status).toBe(429);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('runtime status endpoint stays a bare health probe without configured auth', async () => {
    const tempDir = makeTempDir();
    const snapshotPath = path.join(tempDir, '.modern/contract-gates.json');

    try {
      const config = getDefaultConfig();
      config.server = {
        telemetry: {
          enabled: true,
          canary: {
            enabled: true,
            autopilot: {
              enabled: true,
              gateSnapshotPath: snapshotPath,
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
        injectTelemetryPlugin(),
      ]);

      await server.init();

      const response = await server.request('/_modern/runtime/status', {}, {});
      expect(response.status).toBe(200);
      const payload = (await response.json()) as Record<string, unknown>;
      expect(payload.ok).toBe(true);
      expect(typeof payload.timestamp).toBe('number');
      // No telemetry/canary/trust internals are disclosed without auth.
      expect(payload.telemetry).toBeUndefined();
      expect(payload.canary).toBeUndefined();
      expect(payload.runtimeFallbackSignal).toBeUndefined();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('runtime status auth works even when the signal endpoint stays disabled', async () => {
    const tempDir = makeTempDir();
    const snapshotPath = path.join(tempDir, '.modern/contract-gates.json');

    try {
      const config = getDefaultConfig();
      config.server = {
        telemetry: {
          enabled: true,
          canary: {
            enabled: true,
            autopilot: {
              enabled: true,
              gateSnapshotPath: snapshotPath,
              runtimeFallbackSignal: {
                // endpoint stays disabled, but its auth config still guards
                // the status endpoint detail view.
                auth: {
                  enabled: true,
                  expectedValue: 'status-only-token',
                },
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
        injectTelemetryPlugin(),
      ]);

      await server.init();

      const signalResponse = await server.request(
        '/_modern/contract-gates/runtime-fallback',
        {
          method: 'POST',
          headers: new Headers({
            'content-type': 'application/json',
            'x-modernjs-runtime-signal-token': 'status-only-token',
          }),
          body: JSON.stringify({ appName: 'dashboard' }),
        },
        {},
      );
      expect(signalResponse.status).toBe(404);

      const unauthorized = await server.request(
        '/_modern/runtime/status',
        {},
        {},
      );
      expect(unauthorized.status).toBe(401);

      const authorized = await server.request(
        '/_modern/runtime/status',
        {
          method: 'GET',
          headers: new Headers({
            'x-modernjs-runtime-signal-token': 'status-only-token',
          }),
        },
        {},
      );
      expect(authorized.status).toBe(200);
      const payload = (await authorized.json()) as Record<string, any>;
      expect(payload.ok).toBe(true);
      expect(payload.canary?.enabled).toBe(true);
      expect(payload.runtimeFallbackSignal?.enabled).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
