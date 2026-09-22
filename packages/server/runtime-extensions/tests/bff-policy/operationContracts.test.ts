import 'reflect-metadata';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import {
  buildOperationContractMap,
  createOperationContractHash,
  createOperationEntries,
  DEFAULT_OPERATION_VERSION,
  deriveOperationVersion,
  type OperationContractSource,
} from '../../src/bff-policy/operationContracts';
import { digestOperationContract } from '../../src/bff-policy/operationIdentity';
import { resolveOperationProducer } from '../../src/bff-policy/producer';

const createSchemaHandler = (schema: z.ZodType) => {
  const handler = () => ({ ok: true });
  Reflect.defineMetadata('DATA', schema, handler);
  return handler;
};

describe('operation contract utilities', () => {
  test('browser and Node hash the same canonical operation including nested schemas', async () => {
    const operation = {
      name: 'café',
      httpMethod: 'post',
      routePath: '/api/:id',
      schemas: {
        QUERY: {
          properties: { z: { type: 'number' }, a: { enum: ['x', 'y'] } },
        },
      },
    };
    expect(await digestOperationContract(operation, 'producer')).toBe(
      createOperationContractHash(operation, 'producer'),
    );
  });

  test('resolves the owning producer beyond former depth limits and never borrows its parent version', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bff-producer-'));
    const producer = path.join(root, 'producer');
    const nested = path.join(
      producer,
      ...Array.from({ length: 35 }, () => 'nested'),
    );
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ version: '99.0.0' }),
    );
    fs.writeFileSync(
      path.join(producer, 'package.json'),
      JSON.stringify({ name: 'producer', version: '3.1.0' }),
    );
    try {
      const dependencies: string[] = [];
      expect(
        resolveOperationProducer({
          directories: [nested, root],
          onDependency: file => dependencies.push(file),
        }),
      ).toEqual({ requestId: 'producer', operationVersion: 3 });
      expect(dependencies).toEqual([path.join(producer, 'package.json')]);
      fs.writeFileSync(path.join(producer, 'package.json'), '{broken');
      expect(
        resolveOperationProducer({
          directories: [nested, root],
          requestId: ' explicit ',
        }),
      ).toEqual({ requestId: 'explicit', operationVersion: 1 });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
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
    ] satisfies OperationContractSource[];

    const entries = createOperationEntries(handlers);
    expect(entries.map(item => item.name)).toEqual(['alpha', 'beta']);
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
    ] satisfies OperationContractSource[];

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
