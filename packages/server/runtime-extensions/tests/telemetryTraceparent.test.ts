import {
  createDefaultPlugins,
  createServerBase,
  type ServerPlugin,
} from '@modern-js/server-core';
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { injectTelemetryPlugin } from '../src/telemetry';
import { getDefaultAppContext, getDefaultConfig } from './helpers';

type CapturedEnvelope = {
  name?: string;
  traceId?: string;
  spanId?: string;
};

const createCaptureServer = async () => {
  const envelopes: CapturedEnvelope[] = [];

  const server = createServer((req, res) => {
    const chunks: string[] = [];
    req.on('data', chunk => {
      chunks.push(String(chunk));
    });
    req.on('end', () => {
      try {
        const body = JSON.parse(chunks.join('')) as {
          events?: CapturedEnvelope[];
        };
        envelopes.push(...(body.events || []));
      } catch {
        // ignore malformed payloads
      }
      res.statusCode = 200;
      res.end('ok');
    });
  });

  await new Promise<void>(resolve => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;

  return {
    endpoint: `http://127.0.0.1:${port}/v1/logs`,
    envelopes,
    close: () =>
      new Promise<void>(resolve => {
        server.close(() => resolve());
      }),
  };
};

const waitForEnvelope = async (
  envelopes: CapturedEnvelope[],
  name: string,
  timeoutMs = 5_000,
) => {
  const startedAt = Date.now();
  for (;;) {
    const found = envelopes.find(item => item.name === name);
    if (found) {
      return found;
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for telemetry envelope "${name}"`);
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
};

describe('telemetry envelope traceparent tagging (W3C strict)', () => {
  test('propagates valid traceparent ids and drops all-zero ids', async () => {
    const capture = await createCaptureServer();

    try {
      const config = getDefaultConfig();
      (config as Record<string, any>).server = {
        telemetry: {
          enabled: true,
          // flush on every enqueue so the capture server sees envelopes
          // without waiting for the interval timer
          maxBatchSize: 1,
          flushIntervalMs: 60_000,
          exporters: {
            otlp: {
              enabled: true,
              endpoint: capture.endpoint,
            },
          },
        },
      };

      const probePlugin: ServerPlugin = {
        name: 'emit-traceparent-probe',
        setup(api) {
          api.onPrepare(() => {
            const { middlewares } = api.getServerContext();
            middlewares.push({
              name: 'emit-traceparent-probe',
              handler: async c => {
                const probeName = c.req.header('x-probe-name') || 'probe';
                c.get('monitors')?.info(probeName);
                return c.json({ ok: true });
              },
            });
          });
        },
      };

      const server = createServerBase({
        config,
        pwd: process.cwd(),
        appContext: getDefaultAppContext(),
      });
      server.addPlugins([
        ...createDefaultPlugins({ logger: false }),
        injectTelemetryPlugin(),
        probePlugin,
      ]);
      await server.init();

      const validResponse = await server.request(
        '/',
        {
          headers: new Headers({
            'x-probe-name': 'probe-valid',
            traceparent:
              '00-0AF7651916CD43DD8448EB211C80319C-B7AD6B7169203331-01',
          }),
        },
        {},
      );
      expect(validResponse.status).toBe(200);

      const allZeroResponse = await server.request(
        '/',
        {
          headers: new Headers({
            'x-probe-name': 'probe-all-zero',
            traceparent:
              '00-00000000000000000000000000000000-0000000000000000-01',
          }),
        },
        {},
      );
      expect(allZeroResponse.status).toBe(200);

      const validEnvelope = await waitForEnvelope(
        capture.envelopes,
        'probe-valid',
      );
      // valid traceparent ids propagate (normalized to lowercase)
      expect(validEnvelope.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
      expect(validEnvelope.spanId).toBe('b7ad6b7169203331');

      const allZeroEnvelope = await waitForEnvelope(
        capture.envelopes,
        'probe-all-zero',
      );
      // all-zero trace/span ids are invalid per the W3C trace-context spec
      // and must not be tagged onto envelopes
      expect(allZeroEnvelope.traceId).toBeUndefined();
      expect(allZeroEnvelope.spanId).toBeUndefined();
    } finally {
      await capture.close();
    }
  });
});
