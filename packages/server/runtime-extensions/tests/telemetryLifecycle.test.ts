import { EventEmitter } from 'node:events';
import {
  createDefaultPlugins,
  createServerBase,
  type ServerPlugin,
} from '@modern-js/server-core';
import { logger } from '@modern-js/utils';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { injectTelemetryPlugin } from '../src/telemetry';
import { getDefaultAppContext, getDefaultConfig } from './helpers';

const emitMonitorEventsPlugin = (input: {
  path: string;
  message: string;
  count: number;
}): ServerPlugin => ({
  name: 'emit-monitor-events',
  setup(api) {
    api.onPrepare(() => {
      const { middlewares } = api.getServerContext();
      middlewares.push({
        name: 'emit-monitor-events',
        path: input.path,
        handler: async (c: any) => {
          const monitors = c.get('monitors');
          for (let index = 0; index < input.count; index++) {
            monitors?.info(`${input.message}-${index}`);
          }
          return c.json({ ok: true });
        },
      });
    });
  },
});

const waitFor = async (
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2_000,
) => {
  const startedAt = Date.now();
  while (!(await predicate())) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('waitFor timed out');
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};

describe('telemetry plugin lifecycle', () => {
  test('wires server.telemetry.slo through to alert emission', async () => {
    const warnSpy = rs.spyOn(logger, 'warn').mockImplementation(() => {});

    try {
      const config = getDefaultConfig();
      config.server = {
        telemetry: {
          enabled: true,
          maxQueueSize: 2,
          maxBatchSize: 500,
          flushIntervalMs: 60_000,
          slo: {
            queueUtilizationWarnThreshold: 0.5,
            queueDroppedWarnThreshold: 1,
            alertCooldownMs: 0,
          },
        },
      } as any;

      const server = createServerBase({
        config,
        pwd: process.cwd(),
        appContext: getDefaultAppContext(),
      });
      server.addPlugins([
        ...createDefaultPlugins({ logger: false }),
        injectTelemetryPlugin(),
        emitMonitorEventsPlugin({
          path: '/emit',
          message: 'slo-probe',
          count: 6,
        }),
      ]);
      await server.init();

      const response = await server.request('/emit', {}, {});
      expect(response.status).toBe(200);

      const sloWarnings = warnSpy.mock.calls.filter(call =>
        String(call[0]).includes('[telemetry.slo]'),
      );
      expect(sloWarnings.length).toBeGreaterThan(0);
      expect(
        sloWarnings.some(call => String(call[0]).includes('queue.drop')),
      ).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('boots canary autopilot lane and exports rollback telemetry', async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-telemetry-lifecycle-'),
    );
    const gateName = 'runtime-mf-fallback-health';
    const signalToken = 'canary-lifecycle-token';
    const snapshotPath = path.join(tempDir, '.modern/contract-gates.json');
    const otlpEndpoint = 'http://127.0.0.1:4318/v1/logs';
    const fetchCalls: Array<{
      url: string;
      body: string;
      headers: HeadersInit | undefined;
    }> = [];
    const fetchMock = rs.fn(async (url: any, init?: RequestInit) => {
      fetchCalls.push({
        url: String(url),
        body: String(init?.body ?? ''),
        headers: init?.headers,
      });
      return new Response('{}', { status: 200 });
    });
    const warnSpy = rs.spyOn(logger, 'warn').mockImplementation(() => {});
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;

    const nodeServerStub = new EventEmitter();
    const stubNodeServerPlugin: ServerPlugin = {
      name: 'stub-node-server',
      setup(api) {
        api.updateServerContext({ nodeServer: nodeServerStub } as any);
      },
    };

    try {
      fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
      fs.writeFileSync(
        snapshotPath,
        JSON.stringify({
          schemaVersion: 1,
          updatedAt: Date.now(),
          gates: {
            [gateName]: {
              passed: true,
              updatedAt: Date.now(),
            },
          },
        }),
        'utf8',
      );

      const config = getDefaultConfig();
      config.server = {
        telemetry: {
          enabled: true,
          service: 'runtime-extensions-test',
          module: 'telemetry-lifecycle',
          environment: 'test',
          maxQueueSize: 64,
          maxBatchSize: 100,
          flushIntervalMs: 60_000,
          slo: {
            queueUtilizationWarnThreshold: 0.01,
            alertCooldownMs: 0,
          },
          exporters: {
            otlp: {
              enabled: true,
              endpoint: otlpEndpoint,
              headers: {
                'x-modernjs-test': 'canary-autopilot',
              },
              timeoutMs: 200,
            },
          },
          canary: {
            enabled: true,
            evaluationIntervalMs: 250,
            minConsecutiveHealthyEvaluations: 1,
            rollbackConsecutiveFailures: 1,
            maxQueueUtilization: 1,
            maxTotalDropped: 0,
            maxUnhealthyExporters: 0,
            contractGates: {
              [gateName]: true,
            },
            autopilot: {
              enabled: true,
              gateSnapshotPath: snapshotPath,
              pollIntervalMs: 250,
              gateStaleAfterMs: 60_000,
              runtimeFallbackSignal: {
                enabled: true,
                endpoint: '/_modern/contract-gates/runtime-fallback',
                gateName,
                failureHoldMs: 5_000,
                maxBodyBytes: 4_096,
                auth: {
                  expectedValue: signalToken,
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
        ...createDefaultPlugins({ logger: false }),
        stubNodeServerPlugin,
        injectTelemetryPlugin(),
        emitMonitorEventsPlugin({
          path: '/emit',
          message: 'canary-request',
          count: 2,
        }),
      ]);
      await server.init();

      const statusHeaders = new Headers({
        'x-modernjs-runtime-signal-token': signalToken,
      });
      let statusPayload: any;

      await waitFor(async () => {
        const status = await server.request(
          '/_modern/runtime/status',
          {
            method: 'GET',
            headers: statusHeaders,
          },
          {},
        );
        expect(status.status).toBe(200);
        statusPayload = await status.json();
        return (
          statusPayload.canary?.state === 'promoted' &&
          statusPayload.canary?.contractGates?.some(
            (gate: any) => gate.name === gateName && gate.passed === true,
          )
        );
      });

      const emitResponse = await server.request('/emit', {}, {});
      expect(emitResponse.status).toBe(200);

      const signalResponse = await server.request(
        '/_modern/contract-gates/runtime-fallback',
        {
          method: 'POST',
          headers: new Headers({
            'content-type': 'application/json',
            'x-modernjs-runtime-signal-token': signalToken,
          }),
          body: JSON.stringify({
            reason: 'remote_load_failed',
            phase: 'load',
            appName: 'crm',
            entry: 'https://remote.example.com/remoteEntry.js',
          }),
        },
        {},
      );
      expect(signalResponse.status).toBe(202);

      const persistedSnapshot = JSON.parse(
        fs.readFileSync(snapshotPath, 'utf8'),
      ) as {
        gates?: Record<
          string,
          {
            expiresAt?: number;
            passed?: boolean;
            reason?: string;
          }
        >;
      };
      expect(persistedSnapshot.gates?.[gateName]?.passed).toBe(false);
      expect(persistedSnapshot.gates?.[gateName]?.expiresAt).toBeGreaterThan(
        Date.now(),
      );

      await waitFor(async () => {
        const status = await server.request(
          '/_modern/runtime/status',
          {
            method: 'GET',
            headers: statusHeaders,
          },
          {},
        );
        expect(status.status).toBe(200);
        statusPayload = await status.json();
        return (
          statusPayload.canary?.state === 'rolled_back' &&
          statusPayload.canary?.contractGates?.some(
            (gate: any) =>
              gate.name === gateName &&
              gate.passed === false &&
              String(gate.reason).includes('remote_load_failed'),
          )
        );
      }, 4_000);

      expect(statusPayload.telemetry?.exporterHealth).toContainEqual(
        expect.objectContaining({
          name: 'otlp',
          healthy: true,
        }),
      );
      expect(
        fetchCalls.some(
          call =>
            call.url === otlpEndpoint &&
            (call.headers as Record<string, string>)['x-modernjs-test'] ===
              'canary-autopilot',
        ),
      ).toBe(true);
      expect(
        warnSpy.mock.calls.some(call =>
          String(call[0]).includes('[telemetry.slo] queue.utilization'),
        ),
      ).toBe(true);

      nodeServerStub.emit('close');

      await waitFor(() =>
        fetchCalls.some(call =>
          call.body.includes('telemetry.canary.rollback'),
        ),
      );
      const exportedBodies = fetchCalls.map(call => call.body).join('\n');
      expect(exportedBodies).toContain('telemetry.canary.rollback');
      expect(exportedBodies).toContain('canary-request-0');
    } finally {
      nodeServerStub.emit('close');
      globalThis.fetch = originalFetch;
      warnSpy.mockRestore();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('flushes pending envelopes when the node server closes', async () => {
    const fetchCalls: Array<{ url: string; body: string }> = [];
    const fetchMock = rs.fn(async (url: any, init?: any) => {
      fetchCalls.push({ url: String(url), body: String(init?.body ?? '') });
      return new Response('{}', { status: 200 });
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as any;

    const nodeServerStub = new EventEmitter();
    const stubNodeServerPlugin: ServerPlugin = {
      name: 'stub-node-server',
      setup(api) {
        api.updateServerContext({ nodeServer: nodeServerStub } as any);
      },
    };

    try {
      const config = getDefaultConfig();
      config.server = {
        telemetry: {
          enabled: true,
          // make sure nothing flushes before the close event:
          flushIntervalMs: 60_000,
          maxBatchSize: 500,
          exporters: {
            otlp: {
              enabled: true,
              endpoint: 'http://127.0.0.1:9/v1/logs',
            },
          },
        },
      } as any;

      const server = createServerBase({
        config,
        pwd: process.cwd(),
        appContext: getDefaultAppContext(),
      });
      server.addPlugins([
        ...createDefaultPlugins({ logger: false }),
        stubNodeServerPlugin,
        injectTelemetryPlugin(),
        emitMonitorEventsPlugin({
          path: '/emit',
          message: 'close-flush-probe',
          count: 1,
        }),
      ]);
      await server.init();

      // init performed the startup health probe only.
      const callsAfterInit = fetchCalls.length;
      expect(callsAfterInit).toBeGreaterThan(0);

      const response = await server.request('/emit', {}, {});
      expect(response.status).toBe(200);

      // The envelope is queued but not flushed (long flush interval).
      expect(
        fetchCalls.some(call => call.body.includes('close-flush-probe')),
      ).toBe(false);

      nodeServerStub.emit('close');

      await waitFor(() =>
        fetchCalls.some(call => call.body.includes('close-flush-probe')),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
