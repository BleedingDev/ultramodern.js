import { createDataPlatformBatchRequestHandler } from '../src/runtime/effect/handler/batch-handler';

describe('Effect batch operation boundary', () => {
  test('aborts timed-out operations and redacts unexpected failures per item', async () => {
    const loggedErrors: unknown[][] = [];
    const loggerSpy = rstest
      .spyOn(console, 'error')
      .mockImplementation((...args: unknown[]) => {
        loggedErrors.push(args);
      });
    const abortedIds: string[] = [];
    const secret = 'postgres://admin:secret@example.test/private';
    const handler = createDataPlatformBatchRequestHandler({
      dataPlatform: {
        batch: { requestTimeoutMs: 15, maxConcurrency: 3 },
      },
      handleItem: async request => {
        const id = new URL(request.url).pathname.slice(1);
        if (id === 'slow') {
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
        if (id === 'secret') {
          throw new Error(secret);
        }
        return new Response('ok');
      },
    });

    const response = await handler.handle(
      new Request('http://localhost/_data/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          protocolVersion: 1,
          batchId: 'boundary-batch',
          sentAt: Date.now(),
          items: [
            { id: 'slow-id', path: '/slow', method: 'GET' },
            { id: 'secret-id', path: '/secret', method: 'GET' },
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
    const payload = (await response.json()) as {
      items: Array<{ id: string; status: number; body?: string }>;
    };

    expect(payload.items).toHaveLength(4);
    expect(payload.items.map(item => item.id)).toEqual([
      'slow-id',
      'secret-id',
      'ok-id',
      'invalid-header-id',
    ]);
    expect(payload.items[0]).toMatchObject({ id: 'slow-id', status: 504 });
    expect(payload.items[1]).toMatchObject({ id: 'secret-id', status: 500 });
    expect(payload.items[2]).toMatchObject({ id: 'ok-id', status: 200 });
    expect(payload.items[3]).toMatchObject({
      id: 'invalid-header-id',
      status: 400,
    });
    expect(payload.items[0]?.body).not.toContain('15');
    expect(payload.items[1]?.body).not.toContain(secret);
    expect(abortedIds).toEqual(['slow']);
    expect(loggedErrors).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.objectContaining({
            event: 'bff.batch.item.timeout',
            batchId: 'boundary-batch',
            itemId: 'slow-id',
          }),
        ]),
        expect.arrayContaining([
          expect.objectContaining({
            event: 'bff.batch.item.failure',
            batchId: 'boundary-batch',
            itemId: 'secret-id',
            error: expect.objectContaining({ message: secret }),
          }),
        ]),
      ]),
    );

    loggerSpy.mockRestore();
  });
});
