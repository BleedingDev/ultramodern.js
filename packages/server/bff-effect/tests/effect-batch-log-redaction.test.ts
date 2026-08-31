import { createDataPlatformBatchRequestHandler } from '../src/effect/handler/batch-handler';

describe('Effect batch diagnostic redaction', () => {
  test('never logs query secrets or raw thrown error details', async () => {
    const log = rs.spyOn(console, 'error').mockImplementation(() => undefined);
    const handler = createDataPlatformBatchRequestHandler({
      handleItem: async () => {
        throw new Error('database password=hunter2');
      },
    });
    const payload = {
      protocolVersion: 2,
      batchId: 'batch-safe-log',
      sentAt: 1_700_000_000_000,
      items: [
        {
          id: 'item-safe-log',
          path: '/explode?token=super-secret-token',
          method: 'GET',
        },
      ],
    };

    const response = await handler.handle(
      new Request('http://localhost/_data/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    );

    expect(response.status).toBe(200);
    expect(log).toHaveBeenCalledTimes(1);
    const serializedLog = JSON.stringify(log.mock.calls);
    expect(serializedLog).toContain('/explode');
    expect(serializedLog).not.toContain('super-secret-token');
    expect(serializedLog).not.toContain('hunter2');
    expect(serializedLog).not.toContain('password');
  });
});
