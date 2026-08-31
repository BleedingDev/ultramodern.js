import fs from 'node:fs';
import path from 'node:path';

import {
  buildOperationContractMap,
  resolveCrossProjectPolicy,
} from '@modern-js/bff-core';

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
  it('imports only the edge-safe evaluation leaf', () => {
    const sourceRoot = path.resolve(__dirname, '../src');
    const honoSource = fs.readFileSync(
      path.join(sourceRoot, 'hono/cross-project-policy.ts'),
      'utf8',
    );
    const evaluationSource = fs.readFileSync(
      path.join(sourceRoot, 'cross-project-policy/evaluation.ts'),
      'utf8',
    );

    expect(honoSource).toContain("from '../cross-project-policy/evaluation'");
    expect(`${honoSource}\n${evaluationSource}`).not.toMatch(
      /(?:node:fs|node:path|cross-project-policy\/node|from ['"]\.\.\/cross-project-policy['"])/,
    );
  });

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

  it('returns the downstream Response unchanged after an exact match', async () => {
    const customerContract =
      policy.expectedOperationContracts['GET:/api/customer']!;
    const downstream = new Response('customer');
    const middleware = createHonoCrossProjectPolicyMiddleware(
      policy,
      '/api/customer',
    );

    const result = await middleware(
      createContext('GET', createHeaders(customerContract)),
      async () => downstream,
    );

    expect(result).toBe(downstream);
  });
});
