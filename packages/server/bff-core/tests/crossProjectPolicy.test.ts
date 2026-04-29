import { evaluateCrossProjectPolicy } from '../src/security/crossProjectPolicy';
import { buildOperationContractMap } from '../src/security/operationContracts';

describe('cross-project policy', () => {
  test('should skip policy checks when disabled', () => {
    expect(evaluateCrossProjectPolicy({}, { enabled: false })).toBeNull();
  });

  test('should deny missing envelope when policy is enabled', () => {
    const violation = evaluateCrossProjectPolicy(
      {},
      {
        enabled: true,
      },
    );

    expect(violation?.reason).toBe('missing_envelope');
    expect(violation?.status).toBe(403);
  });

  test('should deny invalid envelope payload', () => {
    const violation = evaluateCrossProjectPolicy(
      {
        'x-modernjs-bff-envelope': 'not-json',
      },
      {
        enabled: true,
      },
    );

    expect(violation?.reason).toBe('invalid_envelope');
  });

  test('should deny namespace outside allowlist', () => {
    const violation = evaluateCrossProjectPolicy(
      {
        'x-modernjs-bff-envelope': JSON.stringify({
          requestId: 'billing.producer-a',
        }),
        'x-operation-id': 'billing.producer-a:GET:/api/invoice',
        'x-modernjs-bff-operation-context': JSON.stringify({
          requestId: 'billing.producer-a',
          operationId: 'billing.producer-a:GET:/api/invoice',
          method: 'GET',
          routePath: '/api/invoice',
          schemaHash: 'schema-1',
          operationVersion: 1,
        }),
      },
      {
        enabled: true,
        allowedNamespaces: ['crm'],
      },
    );

    expect(violation?.reason).toBe('namespace_not_allowed');
  });

  test('should deny missing operation context header', () => {
    const violation = evaluateCrossProjectPolicy(
      {
        'x-modernjs-bff-envelope': JSON.stringify({
          requestId: 'crm.producer-a',
        }),
      },
      {
        enabled: true,
      },
    );

    expect(violation?.reason).toBe('missing_operation_context');
  });

  test('should deny missing operation context details header by default', () => {
    const violation = evaluateCrossProjectPolicy(
      {
        'x-modernjs-bff-envelope': JSON.stringify({
          requestId: 'crm.producer-a',
        }),
        'x-operation-id': 'crm.producer-a:GET:/api/customer',
      },
      {
        enabled: true,
      },
    );

    expect(violation?.reason).toBe('missing_operation_context_details');
  });

  test('should allow valid envelope and operation context', () => {
    const violation = evaluateCrossProjectPolicy(
      {
        'x-modernjs-bff-envelope': JSON.stringify({
          requestId: 'crm.producer-a',
        }),
        'x-operation-id': 'crm.producer-a:GET:/api/customer',
        'x-modernjs-bff-operation-context': JSON.stringify({
          requestId: 'crm.producer-a',
          operationId: 'crm.producer-a:GET:/api/customer',
          method: 'GET',
          routePath: '/api/customer',
          schemaHash: 'schema-1',
          operationVersion: 1,
        }),
      },
      {
        enabled: true,
        allowedNamespaces: ['crm', 'billing'],
      },
    );

    expect(violation).toBeNull();
  });

  test('should accept generated operation contract metadata for effect-first producer clients', () => {
    const contracts = buildOperationContractMap({
      handlers: [
        {
          name: 'getProfile',
          httpMethod: 'GET',
          routePath: '/api/profile',
        },
      ],
      requestId: 'crm.producer-a',
    });
    const contract = contracts['GET:/api/profile'];
    expect(contract).toBeDefined();
    if (!contract) {
      throw new Error('Expected generated operation contract');
    }

    const violation = evaluateCrossProjectPolicy(
      {
        'x-modernjs-bff-envelope': JSON.stringify({
          requestId: contract.requestId,
        }),
        'x-operation-id': contract.operationId,
        'x-modernjs-bff-operation-context': JSON.stringify({
          requestId: contract.requestId,
          operationId: contract.operationId,
          method: contract.method,
          routePath: contract.routePath,
          schemaHash: contract.schemaHash,
          operationVersion: contract.operationVersion,
        }),
      },
      {
        enabled: true,
        expectedOperationContracts: {
          [`${contract.method}:${contract.routePath}`]: {
            schemaHash: contract.schemaHash,
            operationVersion: contract.operationVersion,
          },
        },
      },
    );

    expect(violation).toBeNull();
  });

  test('should deny schema hash mismatches against expected operation contracts', () => {
    const violation = evaluateCrossProjectPolicy(
      {
        'x-modernjs-bff-envelope': JSON.stringify({
          requestId: 'crm.producer-a',
        }),
        'x-operation-id': 'crm.producer-a:GET:/api/customer',
        'x-modernjs-bff-operation-context': JSON.stringify({
          requestId: 'crm.producer-a',
          operationId: 'crm.producer-a:GET:/api/customer',
          method: 'GET',
          routePath: '/api/customer',
          schemaHash: 'schema-actual',
          operationVersion: 1,
        }),
      },
      {
        enabled: true,
        expectedOperationContracts: {
          'GET:/api/customer': {
            schemaHash: 'schema-expected',
            operationVersion: 1,
          },
        },
      },
    );

    expect(violation?.reason).toBe('operation_schema_hash_mismatch');
  });

  test('should deny operation version mismatches against expected operation contracts', () => {
    const violation = evaluateCrossProjectPolicy(
      {
        'x-modernjs-bff-envelope': JSON.stringify({
          requestId: 'crm.producer-a',
        }),
        'x-operation-id': 'crm.producer-a:GET:/api/customer',
        'x-modernjs-bff-operation-context': JSON.stringify({
          requestId: 'crm.producer-a',
          operationId: 'crm.producer-a:GET:/api/customer',
          method: 'GET',
          routePath: '/api/customer',
          schemaHash: 'schema-expected',
          operationVersion: 2,
        }),
      },
      {
        enabled: true,
        expectedOperationContracts: {
          'GET:/api/customer': {
            schemaHash: 'schema-expected',
            operationVersion: 1,
          },
        },
      },
    );

    expect(violation?.reason).toBe('operation_version_mismatch');
  });

  test('should deny unknown operation contracts when allowUnknownOperations is false', () => {
    const violation = evaluateCrossProjectPolicy(
      {
        'x-modernjs-bff-envelope': JSON.stringify({
          requestId: 'crm.producer-a',
        }),
        'x-operation-id': 'crm.producer-a:GET:/api/unknown',
        'x-modernjs-bff-operation-context': JSON.stringify({
          requestId: 'crm.producer-a',
          operationId: 'crm.producer-a:GET:/api/unknown',
          method: 'GET',
          routePath: '/api/unknown',
          schemaHash: 'schema-1',
          operationVersion: 1,
        }),
      },
      {
        enabled: true,
        expectedOperationContracts: {
          'GET:/api/customer': {
            schemaHash: 'schema-1',
            operationVersion: 1,
          },
        },
      },
    );

    expect(violation?.reason).toBe('unknown_operation_contract');
  });

  test('should allow unknown operation contracts when allowUnknownOperations is true', () => {
    const violation = evaluateCrossProjectPolicy(
      {
        'x-modernjs-bff-envelope': JSON.stringify({
          requestId: 'crm.producer-a',
        }),
        'x-operation-id': 'crm.producer-a:GET:/api/unknown',
        'x-modernjs-bff-operation-context': JSON.stringify({
          requestId: 'crm.producer-a',
          operationId: 'crm.producer-a:GET:/api/unknown',
          method: 'GET',
          routePath: '/api/unknown',
          schemaHash: 'schema-1',
          operationVersion: 1,
        }),
      },
      {
        enabled: true,
        allowUnknownOperations: true,
        expectedOperationContracts: {
          'GET:/api/customer': {
            schemaHash: 'schema-1',
            operationVersion: 1,
          },
        },
      },
    );

    expect(violation).toBeNull();
  });
});
