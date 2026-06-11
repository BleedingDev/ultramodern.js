import type { APIHandlerInfo } from '../src/router';
import { buildOperationContractMap } from '../src/security/operationContracts';
import { resolveCrossProjectPolicy } from '../src/security/resolveCrossProjectPolicy';
import { HttpMethod } from '../src/types';

const createHandlers = (): APIHandlerInfo[] => [
  {
    name: 'getHello',
    httpMethod: HttpMethod.Get,
    routeName: '/hello',
    routePath: '/hello',
    filename: 'api/hello.ts',
    handler: () => 'hello',
  },
];

describe('resolveCrossProjectPolicy', () => {
  test('returns undefined without policy config or cross-project marker', () => {
    expect(
      resolveCrossProjectPolicy({
        handlers: createHandlers(),
        requestId: 'crm',
      }),
    ).toBeUndefined();
  });

  test('enables policy with strict defaults for cross-project servers', () => {
    const resolved = resolveCrossProjectPolicy({
      handlers: createHandlers(),
      isCrossProjectServer: true,
    });

    expect(resolved).toMatchObject({
      enabled: true,
      requireEnvelope: true,
      requireOperationContext: true,
      requireOperationContextDetails: true,
      requireOperationSchemaHash: true,
      requireOperationVersion: true,
      allowUnknownOperations: false,
    });
  });

  test('keeps explicit user switches over derived defaults', () => {
    const resolved = resolveCrossProjectPolicy({
      crossProjectPolicy: {
        enabled: false,
        requireEnvelope: false,
        allowUnknownOperations: true,
        denyStatus: 451,
      },
      handlers: createHandlers(),
      isCrossProjectServer: true,
    });

    expect(resolved).toMatchObject({
      enabled: false,
      requireEnvelope: false,
      allowUnknownOperations: true,
      denyStatus: 451,
    });
  });

  test('derives operation contracts from handlers and requestId', () => {
    const handlers = createHandlers();
    const resolved = resolveCrossProjectPolicy({
      crossProjectPolicy: { enabled: true },
      handlers,
      requestId: 'crm',
    });

    expect(resolved?.expectedOperationContracts).toEqual(
      buildOperationContractMap({ handlers, requestId: 'crm' }),
    );
  });

  test('falls back to the default requestId when blank', () => {
    const handlers = createHandlers();
    const resolved = resolveCrossProjectPolicy({
      crossProjectPolicy: { enabled: true },
      handlers,
      requestId: '   ',
    });

    expect(resolved?.expectedOperationContracts).toEqual(
      buildOperationContractMap({ handlers, requestId: 'default' }),
    );
  });

  test('generated contracts override user-provided entries for the same key', () => {
    const handlers = createHandlers();
    const generated = buildOperationContractMap({
      handlers,
      requestId: 'crm',
    });
    const resolved = resolveCrossProjectPolicy({
      crossProjectPolicy: {
        enabled: true,
        expectedOperationContracts: {
          'GET:/hello': { schemaHash: 'user-pinned', operationVersion: 9 },
          'POST:/extra': { schemaHash: 'kept', operationVersion: 2 },
        },
      },
      handlers,
      requestId: 'crm',
    });

    expect(resolved?.expectedOperationContracts['GET:/hello']).toEqual(
      generated['GET:/hello'],
    );
    expect(resolved?.expectedOperationContracts['POST:/extra']).toEqual({
      schemaHash: 'kept',
      operationVersion: 2,
    });
  });
});
