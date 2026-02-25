import type { APIHandlerInfo } from '../src/router/types';
import {
  buildOperationContractMap,
  createOperationEntries,
  createOperationSchemaHash,
} from '../src/security/operationContracts';

describe('operation contract utilities', () => {
  test('creates deterministic operation entries and schema hashes', () => {
    const handlers = [
      {
        name: 'beta',
        httpMethod: 'post',
        routePath: '/api/beta',
        filename: '/api/module-a.ts',
      },
      {
        name: 'alpha',
        httpMethod: 'get',
        routePath: '/api/alpha',
        filename: '/api/module-a.ts',
      },
    ] as APIHandlerInfo[];

    const entries = createOperationEntries(handlers);
    expect(entries.map(item => item.name)).toEqual(['alpha', 'beta']);

    const hash1 = createOperationSchemaHash(entries, 'crm-producer');
    const hash2 = createOperationSchemaHash(entries, 'crm-producer');
    expect(hash1).toBe(hash2);
  });

  test('builds per-module operation contracts', () => {
    const handlers = [
      {
        name: 'getCustomer',
        httpMethod: 'get',
        routePath: '/api/customer',
        filename: '/api/crm.ts',
      },
      {
        name: 'listDeals',
        httpMethod: 'get',
        routePath: '/api/deals',
        filename: '/api/crm.ts',
      },
      {
        name: 'createInvoice',
        httpMethod: 'post',
        routePath: '/api/invoice',
        filename: '/api/billing.ts',
      },
    ] as APIHandlerInfo[];

    const contracts = buildOperationContractMap({
      handlers,
      requestId: 'erp-producer',
    });

    expect(contracts['GET:/api/customer']?.requestId).toBe('erp-producer');
    expect(contracts['GET:/api/customer']?.operationVersion).toBe(1);
    expect(contracts['operation:erp-producer:getCustomer']?.method).toBe('GET');
    expect(contracts['POST:/api/invoice']?.schemaHash).toBeTruthy();
    expect(contracts['GET:/api/customer']?.schemaHash).not.toBe(
      contracts['POST:/api/invoice']?.schemaHash,
    );
  });
});
