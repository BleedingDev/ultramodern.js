import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildOperationContractMap,
  resolveCrossProjectPolicy,
} from '@modern-js/bff-core';
import type { ServerPluginAPI } from '@modern-js/server-core';
import { resolveAdapterCrossProjectPolicy } from '../src/cross-project-policy';
import {
  checkCrossProjectPolicyForRequest,
  checkCrossProjectPolicyResponse,
} from '../src/cross-project-policy/evaluation';

const REQUEST_ID = 'crm.producer-a';
const handlers = [
  {
    name: 'getCustomer',
    routePath: '/api/customer/:id',
    httpMethod: 'GET',
  },
];

const createPolicy = () =>
  resolveCrossProjectPolicy({
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

describe('cross-project server policy source', () => {
  it('discovers the producer version without relying on a CommonJS require', () => {
    const packageDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-bff-policy-'),
    );
    const apiDirectory = path.join(packageDirectory, 'dist', 'api');
    fs.mkdirSync(apiDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(packageDirectory, 'package.json'),
      JSON.stringify({ version: '7.4.2' }),
    );

    try {
      const api = {
        getServerConfig: () => ({
          bff: {
            crossProjectPolicy: { enabled: true },
            isCrossProjectServer: true,
            requestId: REQUEST_ID,
          },
        }),
        getServerContext: () => ({ apiDirectory }),
      } as unknown as ServerPluginAPI;

      const policy = resolveAdapterCrossProjectPolicy(api, handlers);
      expect(
        policy?.expectedOperationContracts['GET:/api/customer/:id']
          ?.operationVersion,
      ).toBe(7);
    } finally {
      fs.rmSync(packageDirectory, { recursive: true, force: true });
    }
  });

  it('fails closed when project identity headers are absent', async () => {
    const denial = checkCrossProjectPolicyResponse({}, createPolicy(), {
      method: 'GET',
      routePath: '/api/customer/:id',
    });

    expect(denial).toBeInstanceOf(Response);
    expect(denial?.status).toBe(403);
    await expect(denial?.json()).resolves.toMatchObject({
      reason: 'missing_envelope',
    });
  });

  it('binds a concrete request path to its server-known route template', () => {
    const policy = createPolicy();
    const contract =
      policy.expectedOperationContracts['GET:/api/customer/:id']!;
    const request = new Request(
      'https://producer.example/api/customer/customer-42',
      { headers: createHeaders(contract) },
    );

    expect(checkCrossProjectPolicyForRequest(request, policy)).toBeNull();
  });
});
