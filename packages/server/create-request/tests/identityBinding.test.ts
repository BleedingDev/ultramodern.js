import { storage } from '@modern-js/runtime-utils/node';
import nock from 'nock';
import { configure, createRequest } from '../src/node';

describe('identity binding headers', () => {
  const path = '/api';
  const method = 'GET';
  const response = {
    code: 200,
    data: {
      message: 'hello Modernjs',
    },
  };

  const run = (
    headers: Record<string, string>,
    callback: () => Promise<void> | void,
  ) =>
    storage.run(
      {
        headers,
        monitors: {} as any,
      },
      callback,
    );

  test('should not forward case-variant protected identity headers beside server-derived binding', async () => {
    const producer = 'producer-identity-case-collision';
    const producerUrl = 'http://127.0.0.1:9088';

    await run({}, async () => {
      nock(producerUrl).get(path).reply(200, response);
      const customRequest = rs.fn((requestPath: any, init: any) =>
        fetch(requestPath, init),
      );

      configure({
        request: customRequest as unknown as typeof fetch,
        requestId: producer,
        allowedHeaders: ['X-Tenant-Id'],
        resolveHeaders: () => ({
          'X-Tenant-Id': 'tenant-resolved',
        }),
        operationContract: {
          enabled: false,
        },
        identityBinding: {
          deriveHeaders: () => ({
            'x-tenant-id': 'tenant-bound',
          }),
          strict: false,
        },
        setDomain: () => producerUrl,
      });

      const request = createRequest(
        path,
        method,
        8080,
        undefined,
        undefined,
        producer,
      );

      await request();
      const headers = customRequest.mock.calls[0]?.[1]?.headers;

      expect(headers['X-Tenant-Id']).toBeUndefined();
      expect(headers['x-tenant-id']).toBe('tenant-resolved');
    });
  });
});
