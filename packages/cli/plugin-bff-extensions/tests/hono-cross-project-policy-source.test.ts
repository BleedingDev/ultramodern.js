import { Hono } from '@modern-js/server-core';

import {
  buildOperationContractMap,
  resolveCrossProjectPolicy,
} from '@modern-js/server-runtime-extensions/bff-policy/node';

import { createHonoCrossProjectPolicyMiddleware } from '../src/hono/cross-project-policy';

const REQUEST_ID = 'crm.producer-a';
const handlers = [
  { name: 'getCustomer', routePath: '/api/customer', httpMethod: 'GET' },
  { name: 'createOrder', routePath: '/api/orders', httpMethod: 'POST' },
];

const policy = resolveCrossProjectPolicy({
  crossProjectPolicy: { enabled: true },
  handlers,
  requestId: REQUEST_ID,
  isCrossProjectServer: true,
})!;

const createHeaders = (
  contract: ReturnType<typeof buildOperationContractMap>[string],
): Record<string, string> => ({
  'x-modernjs-bff-envelope': JSON.stringify({ requestId: REQUEST_ID }),
  'x-operation-id': contract.operationId,
  'x-modernjs-bff-operation-context': JSON.stringify({
    requestId: REQUEST_ID,
    operationId: contract.operationId,
    method: contract.method,
    routePath: contract.routePath,
    schemaHash: contract.schemaHash,
    operationVersion: contract.operationVersion,
  }),
});

const createContext = (method: string, headers: Record<string, string>) =>
  ({
    req: {
      method,
      header: () => headers,
    },
  }) as never;

describe('exact-route Hono cross-project policy', () => {
  it('rejects valid credentials for a different registered route', async () => {
    const orderContract =
      policy.expectedOperationContracts['POST:/api/orders']!;
    const middleware = createHonoCrossProjectPolicyMiddleware(
      policy,
      '/api/customer',
    );
    const next = rstest.fn(async () => undefined);

    const result = await middleware(
      createContext('GET', createHeaders(orderContract)),
      next,
    );

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
    await expect((result as Response).json()).resolves.toMatchObject({
      reason: 'operation_context_mismatch',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'returns the downstream Response unchanged when policy is enabled=%s',
    async enabled => {
      const customerContract =
        policy.expectedOperationContracts['GET:/api/customer']!;
      const downstream = new Response('customer');
      const middleware = createHonoCrossProjectPolicyMiddleware(
        { ...policy, enabled },
        '/api/customer',
      );

      const result = await middleware(
        createContext('GET', createHeaders(customerContract)),
        async () => downstream,
      );

      expect(result).toBe(downstream);
    },
  );

  it('preserves the standard void next contract', async () => {
    const customerContract =
      policy.expectedOperationContracts['GET:/api/customer']!;
    const next = rstest.fn(async () => undefined);
    const middleware = createHonoCrossProjectPolicyMiddleware(
      policy,
      '/api/customer',
    );
    await expect(
      middleware(createContext('GET', createHeaders(customerContract)), next),
    ).resolves.toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['absent', undefined],
    ['disabled', false],
    ['enabled', true],
  ] as const)(
    'preserves the native Hono empty-handler response with policy %s',
    async (_label, enabled) => {
      const app = new Hono();
      if (enabled !== undefined) {
        app.get(
          '/api/customer',
          createHonoCrossProjectPolicyMiddleware(
            { ...policy, enabled },
            '/api/customer',
          ),
        );
      }
      app.get('/api/customer', async () => undefined);
      const response = await app.request('/api/customer', {
        headers: enabled
          ? createHeaders(
              policy.expectedOperationContracts['GET:/api/customer']!,
            )
          : {},
      });
      const control = new Hono();
      if (enabled !== undefined) {
        control.get('/api/customer', async (_context, next) => {
          await next();
        });
      }
      control.get('/api/customer', async () => undefined);
      const expected = await control.request('/api/customer');
      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(expected.status);
      await expect(response.text()).resolves.toBe(await expected.text());
    },
  );
});
