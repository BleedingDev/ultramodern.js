import { EventEmitter } from 'node:events';
import {
  createDefaultPlugins,
  createServerBase,
  type ServerPlugin,
} from '@modern-js/server-core';
import { logger } from '@modern-js/utils';
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

const waitFor = async (predicate: () => boolean, timeoutMs = 2_000) => {
  const startedAt = Date.now();
  while (!predicate()) {
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
