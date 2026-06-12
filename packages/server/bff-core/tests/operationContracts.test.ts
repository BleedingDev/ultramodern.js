import 'reflect-metadata';
import { z } from 'zod';
import type { APIHandlerInfo } from '../src/router/types';
import {
  buildOperationContractMap,
  createOperationContractHash,
  createOperationEntries,
  createOperationSchemaHash,
  DEFAULT_OPERATION_VERSION,
  deriveOperationVersion,
  serializeOperationSchemas,
} from '../src/security/operationContracts';
import { HttpMetadata } from '../src/types';

const createSchemaHandler = (schema: z.ZodType) => {
  const handler = () => ({ ok: true });
  Reflect.defineMetadata(HttpMetadata.Data, schema, handler);
  return handler;
};

describe('operation contract utilities', () => {
  test('creates deterministic operation entries and aggregate hashes', () => {
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

  test('builds per-operation contracts keyed by route and operation id', () => {
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

  test('schema hash changes when an operation input schema changes', () => {
    const baseRoute = {
      name: 'createCustomer',
      httpMethod: 'POST',
      routePath: '/api/customer',
      filename: '/api/crm.ts',
    };

    const contractsV1 = buildOperationContractMap({
      handlers: [
        {
          ...baseRoute,
          handler: createSchemaHandler(z.object({ name: z.string() })),
        },
      ],
      requestId: 'crm',
    });
    const contractsV2 = buildOperationContractMap({
      handlers: [
        {
          ...baseRoute,
          handler: createSchemaHandler(
            z.object({ name: z.string(), email: z.string() }),
          ),
        },
      ],
      requestId: 'crm',
    });
    const contractsV1Again = buildOperationContractMap({
      handlers: [
        {
          ...baseRoute,
          handler: createSchemaHandler(z.object({ name: z.string() })),
        },
      ],
      requestId: 'crm',
    });

    // changing the zod schema (the actual API contract) rotates the hash...
    expect(contractsV1['POST:/api/customer']!.schemaHash).not.toBe(
      contractsV2['POST:/api/customer']!.schemaHash,
    );
    // ...and the same schema produces the same hash.
    expect(contractsV1['POST:/api/customer']!.schemaHash).toBe(
      contractsV1Again['POST:/api/customer']!.schemaHash,
    );
  });

  test('per-operation hashes are stable across route reordering', () => {
    const handlerA = {
      name: 'alpha',
      httpMethod: 'GET',
      routePath: '/api/alpha',
      filename: '/api/module.ts',
      handler: createSchemaHandler(z.object({ q: z.string() })),
    };
    const handlerB = {
      name: 'beta',
      httpMethod: 'POST',
      routePath: '/api/beta',
      filename: '/api/module.ts',
    };

    const ordered = buildOperationContractMap({
      handlers: [handlerA, handlerB],
      requestId: 'crm',
    });
    const reversed = buildOperationContractMap({
      handlers: [handlerB, handlerA],
      requestId: 'crm',
    });

    expect(ordered['GET:/api/alpha']!.schemaHash).toBe(
      reversed['GET:/api/alpha']!.schemaHash,
    );
    expect(ordered['POST:/api/beta']!.schemaHash).toBe(
      reversed['POST:/api/beta']!.schemaHash,
    );
  });

  test('adding an unrelated operation does not rotate sibling hashes', () => {
    const existing = {
      name: 'getCustomer',
      httpMethod: 'GET',
      routePath: '/api/customer',
      filename: '/api/crm.ts',
    };
    const before = buildOperationContractMap({
      handlers: [existing],
      requestId: 'crm',
    });
    const after = buildOperationContractMap({
      handlers: [
        existing,
        {
          name: 'deleteCustomer',
          httpMethod: 'DELETE',
          routePath: '/api/customer/:id',
          filename: '/api/crm.ts',
        },
      ],
      requestId: 'crm',
    });

    // regression guard for the old per-module grouping, where adding any
    // endpoint to a lambda file rotated every sibling operation hash.
    expect(after['GET:/api/customer']!.schemaHash).toBe(
      before['GET:/api/customer']!.schemaHash,
    );
  });

  test('hashes are scoped by requestId', () => {
    const handler = {
      name: 'getCustomer',
      httpMethod: 'GET',
      routePath: '/api/customer',
    };
    const a = createOperationContractHash(handler, 'producer-a');
    const b = createOperationContractHash(handler, 'producer-b');
    expect(a).not.toBe(b);
  });

  test('serializeOperationSchemas returns undefined without schema metadata', () => {
    expect(serializeOperationSchemas(() => undefined)).toBeUndefined();
    expect(serializeOperationSchemas(undefined)).toBeUndefined();
  });

  test('buildOperationContractMap propagates the operation version', () => {
    const contracts = buildOperationContractMap({
      handlers: [
        {
          name: 'getCustomer',
          httpMethod: 'GET',
          routePath: '/api/customer',
        },
      ],
      requestId: 'crm',
      operationVersion: 4,
    });
    expect(contracts['GET:/api/customer']!.operationVersion).toBe(4);
  });

  test('deriveOperationVersion derives the semver major', () => {
    expect(deriveOperationVersion('2.3.1')).toBe(2);
    expect(deriveOperationVersion('v3.0.0')).toBe(3);
    expect(deriveOperationVersion('0.4.2')).toBe(0);
    expect(deriveOperationVersion('not-a-version')).toBe(
      DEFAULT_OPERATION_VERSION,
    );
    expect(deriveOperationVersion(undefined)).toBe(DEFAULT_OPERATION_VERSION);
  });
});
