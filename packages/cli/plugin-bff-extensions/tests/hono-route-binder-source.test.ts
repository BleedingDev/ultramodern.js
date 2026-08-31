import {
  buildOperationContractMap,
  resolveCrossProjectPolicy,
} from '@modern-js/bff-core';
import type { MiddlewareHandler } from '@modern-js/server-core';

import { bindHonoRouteHandlers } from '../src/hono';

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
  ({ req: { method, header: () => headers } }) as never;

const asHandlers = (
  value: MiddlewareHandler | MiddlewareHandler[],
): MiddlewareHandler[] => (Array.isArray(value) ? value : [value]);

describe('Hono route handler binding', () => {
  it('binds policy to the exact route before dispatch', async () => {
    const orderContract =
      policy.expectedOperationContracts['POST:/api/orders']!;
    const routeHandler = rstest.fn(async () => new Response('customer'));
    const bound = asHandlers(
      bindHonoRouteHandlers({
        handler: routeHandler,
        policy,
        routePath: '/api/customer',
      }),
    );

    const result = await bound[0]!(
      createContext('GET', createHeaders(orderContract)),
      async () => undefined,
    );

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
    expect(routeHandler).not.toHaveBeenCalled();
  });

  it('preserves the exact downstream Response on an allowed policy', async () => {
    const customerContract =
      policy.expectedOperationContracts['GET:/api/customer']!;
    const downstream = new Response('downstream');
    const bound = asHandlers(
      bindHonoRouteHandlers({
        handler: async () => new Response('handler'),
        policy,
        routePath: '/api/customer',
      }),
    );

    const result = await bound[0]!(
      createContext('GET', createHeaders(customerContract)),
      (async () => downstream) as never,
    );

    expect(result).toBe(downstream);
  });

  it('preserves an onError Response and wraps only the first route handler', async () => {
    const expected = new Response('configured', { status: 418 });
    const second: MiddlewareHandler = async () => new Response('second');
    const onError = rstest.fn(async () => expected);
    const bound = asHandlers(
      bindHonoRouteHandlers({
        handler: [
          async () => {
            throw new Error('route failed');
          },
          second,
        ],
        routePath: '/api/customer',
        onError,
      }),
    );

    expect(bound).toHaveLength(2);
    expect(bound[1]).toBe(second);
    await expect(
      bound[0]!(createContext('GET', {}), async () => undefined),
    ).resolves.toBe(expected);
  });

  it('returns a safe failure when onError throws', async () => {
    const reportError = rstest.fn();
    const bound = asHandlers(
      bindHonoRouteHandlers({
        handler: async () => {
          throw new Error('private route detail');
        },
        routePath: '/api/customer',
        onError: async () => {
          throw new Error('configured handler failed');
        },
        reportError,
      }),
    );

    const response = (await bound[0]!(
      createContext('GET', {}),
      async () => undefined,
    )) as Response;

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.not.toContain(
      'private route detail',
    );
    expect(reportError).toHaveBeenCalledWith(
      expect.stringContaining('configured handler failed'),
    );
  });
});
