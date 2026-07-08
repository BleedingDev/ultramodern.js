import { evaluateCrossProjectPolicy } from '../src/security/crossProjectPolicy';
import { buildOperationContractMap } from '../src/security/operationContracts';

const NAMESPACE_ALLOWLIST_REQUIRES_VERIFIER_MESSAGE =
  'cross-project namespace allowlist requires verifyProducerIdentity in production';

const withNodeEnv = <T>(nodeEnv: string, callback: () => T): T => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = nodeEnv;
  try {
    return callback();
  } finally {
    if (typeof previousNodeEnv === 'undefined') {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
  }
};

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
        verifyProducerIdentity: () => 'billing',
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
        verifyProducerIdentity: () => 'crm',
      },
    );

    expect(violation).toBeNull();
  });

  test('should deny operation context header/detail operationId mismatch', () => {
    const violation = evaluateCrossProjectPolicy(
      {
        'x-modernjs-bff-envelope': JSON.stringify({
          requestId: 'crm.producer-a',
        }),
        'x-operation-id': 'crm.producer-a:GET:/api/customer',
        'x-modernjs-bff-operation-context': JSON.stringify({
          requestId: 'crm.producer-a',
          operationId: 'crm.producer-a:GET:/api/invoice',
          method: 'GET',
          routePath: '/api/invoice',
          schemaHash: 'schema-invoice',
          operationVersion: 1,
        }),
      },
      {
        enabled: true,
        expectedOperationContracts: {
          'GET:/api/invoice': {
            schemaHash: 'schema-invoice',
            operationVersion: 1,
          },
        },
      },
    );

    expect(violation?.reason).toBe('operation_context_mismatch');
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

  test('should deny unknown operation contracts when the expected contract map is empty', () => {
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
        expectedOperationContracts: {},
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

describe('cross-project policy producer identity binding', () => {
  const spoofableHeaders = {
    'x-modernjs-bff-envelope': JSON.stringify({
      requestId: 'crm.producer-a',
    }),
  };

  test('denies when the client-asserted namespace does not match verified identity', () => {
    // Spoofed-header case: the caller echoes an allowlisted requestId, but
    // the verified channel (e.g. mTLS peer identity) says "billing".
    const violation = evaluateCrossProjectPolicy(spoofableHeaders, {
      enabled: true,
      allowedNamespaces: ['crm'],
      verifyProducerIdentity: () => 'billing',
    });

    expect(violation?.reason).toBe('producer_identity_mismatch');
    expect(violation?.status).toBe(403);
  });

  test('denies when producer identity cannot be verified', () => {
    const violation = evaluateCrossProjectPolicy(spoofableHeaders, {
      enabled: true,
      verifyProducerIdentity: () => undefined,
    });

    expect(violation?.reason).toBe('producer_identity_mismatch');
  });

  test('checks the allowlist against the verified namespace when identities match', () => {
    const verifier = (headers: Record<string, unknown>) =>
      typeof headers['x-verified-producer'] === 'string'
        ? (headers['x-verified-producer'] as string)
        : undefined;

    const allowed = evaluateCrossProjectPolicy(
      {
        ...spoofableHeaders,
        'x-verified-producer': 'crm',
      },
      {
        enabled: true,
        allowedNamespaces: ['crm'],
        requireOperationContext: false,
        verifyProducerIdentity: verifier,
      },
    );
    expect(allowed).toBeNull();

    const denied = evaluateCrossProjectPolicy(
      {
        'x-modernjs-bff-envelope': JSON.stringify({
          requestId: 'billing.producer-z',
        }),
        'x-verified-producer': 'billing',
      },
      {
        enabled: true,
        allowedNamespaces: ['crm'],
        requireOperationContext: false,
        verifyProducerIdentity: verifier,
      },
    );
    expect(denied?.reason).toBe('namespace_not_allowed');
  });

  test('in development, namespace allowlist without verifier warns and remains advisory', () => {
    const warnSpy = rstest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    try {
      const firstResult = withNodeEnv('development', () =>
        evaluateCrossProjectPolicy(spoofableHeaders, {
          enabled: true,
          allowedNamespaces: ['crm'],
          requireOperationContext: false,
        }),
      );
      const secondResult = withNodeEnv('development', () =>
        evaluateCrossProjectPolicy(spoofableHeaders, {
          enabled: true,
          allowedNamespaces: ['crm'],
          requireOperationContext: false,
        }),
      );

      expect(firstResult).toBeNull();
      expect(secondResult).toBeNull();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain(
        NAMESPACE_ALLOWLIST_REQUIRES_VERIFIER_MESSAGE,
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('in production, namespace allowlist without verifier fails closed', () => {
    const violation = withNodeEnv('production', () =>
      evaluateCrossProjectPolicy(spoofableHeaders, {
        enabled: true,
        allowedNamespaces: ['crm'],
        requireOperationContext: false,
      }),
    );

    expect(violation?.reason).toBe('producer_identity_mismatch');
    expect(violation?.message).toBe(
      NAMESPACE_ALLOWLIST_REQUIRES_VERIFIER_MESSAGE,
    );
  });
});
