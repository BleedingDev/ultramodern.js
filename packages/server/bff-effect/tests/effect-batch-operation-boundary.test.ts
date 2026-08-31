import type { DataBatchResponsePayload } from '../src/data-platform';
import { decodeBatchBody } from '../src/data-platform/batch/protocol';
import { createDataPlatformBatchRequestHandler } from '../src/effect/handler/batch-handler';

describe('Effect batch operation boundary', () => {
  test('isolates mixed item failures without leaking diagnostics or changing order', async () => {
    const loggedErrors: unknown[][] = [];
    const loggerSpy = rs
      .spyOn(console, 'error')
      .mockImplementation((...args: unknown[]) => {
        loggedErrors.push(args);
      });
    const abortedIds: string[] = [];
    const thrownSecret = 'postgres://admin:secret@example.test/private';
    const querySecret = 'bearer-token-that-must-not-be-logged';
    let releaseSlow!: () => void;
    const slowGate = new Promise<void>(resolve => {
      releaseSlow = resolve;
    });
    const handler = createDataPlatformBatchRequestHandler({
      dataPlatform: {
        batch: { requestTimeoutMs: 15, maxConcurrency: 4 },
      },
      handleItem: async request => {
        const id = new URL(request.url).pathname.slice(1);
        if (id === 'slow') {
          await slowGate;
          return new Response('slow', { status: 202 });
        }
        if (id === 'timeout') {
          return new Promise<Response>((_resolve, reject) => {
            request.signal.addEventListener(
              'abort',
              () => {
                abortedIds.push(id);
                reject(request.signal.reason);
              },
              { once: true },
            );
          });
        }
        if (id === 'throw') {
          throw new Error(thrownSecret);
        }
        if (id === 'ok') {
          releaseSlow();
          return new Response('ok');
        }
        throw new Error(`Unexpected dispatch: ${id}`);
      },
    });

    try {
      const response = await handler.handle(
        new Request('http://localhost/_data/batch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            protocolVersion: 2,
            batchId: 'boundary-batch',
            sentAt: Date.now(),
            items: [
              { id: 'slow-id', path: '/slow', method: 'GET' },
              {
                id: 'timeout-id',
                path: `/timeout?token=${encodeURIComponent(querySecret)}`,
                method: 'GET',
              },
              {
                id: 'throw-id',
                path: `/throw?token=${encodeURIComponent(querySecret)}`,
                method: 'GET',
              },
              { id: 'ok-id', path: '/ok', method: 'GET' },
              {
                id: 'invalid-header-id',
                path: '/never-dispatched',
                method: 'GET',
                headers: { 'invalid header': 'value' },
              },
            ],
          }),
        }),
      );
      const payload = (await response.json()) as DataBatchResponsePayload;
      const decoder = new TextDecoder();
      const bodyTexts = payload.items.map(item =>
        item.body ? decoder.decode(decodeBatchBody(item.body)) : undefined,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('x-modernjs-data-batch')).toBe('2');
      expect(payload.protocolVersion).toBe(2);
      expect(payload.items.map(item => item.id)).toEqual([
        'slow-id',
        'timeout-id',
        'throw-id',
        'ok-id',
        'invalid-header-id',
      ]);
      expect(payload.items.map(item => item.status)).toEqual([
        202, 504, 500, 200, 400,
      ]);
      expect(bodyTexts).toEqual([
        'slow',
        JSON.stringify({ message: 'Batch item request timed out' }),
        JSON.stringify({ message: 'Internal Server Error' }),
        'ok',
        JSON.stringify({ message: 'Invalid batch item headers' }),
      ]);
      expect(abortedIds).toEqual(['timeout']);

      expect(loggedErrors.map(args => args[0])).toEqual([
        {
          event: 'bff.batch.item.failure',
          batchId: 'boundary-batch',
          itemId: 'throw-id',
          method: 'GET',
          path: '/throw',
          errorName: 'Error',
        },
        {
          event: 'bff.batch.item.timeout',
          batchId: 'boundary-batch',
          itemId: 'timeout-id',
          method: 'GET',
          path: '/timeout',
          errorName: 'Error',
        },
      ]);
      const serializedDiagnostics = JSON.stringify(loggedErrors);
      expect(serializedDiagnostics.length).toBeLessThan(512);
      expect(serializedDiagnostics).not.toContain(thrownSecret);
      expect(serializedDiagnostics).not.toContain(querySecret);
    } finally {
      loggerSpy.mockRestore();
    }
  });
});
