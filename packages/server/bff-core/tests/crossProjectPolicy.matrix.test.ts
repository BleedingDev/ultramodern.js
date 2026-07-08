import {
  type CrossProjectPolicyConfig,
  type CrossProjectPolicyViolationReason,
  evaluateCrossProjectPolicy,
} from '../src/security/crossProjectPolicy';

const ENVELOPE_HEADER = 'x-modernjs-bff-envelope';
const OPERATION_CONTEXT_HEADER = 'x-operation-id';
const OPERATION_CONTEXT_DETAIL_HEADER = 'x-modernjs-bff-operation-context';
const VERIFIED_PRODUCER_HEADER = 'x-verified-producer';

const OMIT = Symbol('omit header');

type RawHeader = {
  kind: 'raw';
  value: string;
};

type HeaderInput = RawHeader | unknown | typeof OMIT;

type PolicyMatrixScenario = {
  name: string;
  headers?: Record<string, unknown>;
  envelope?: HeaderInput;
  operationContext?: string | typeof OMIT;
  detail?: HeaderInput;
  config: CrossProjectPolicyConfig;
  nodeEnv?: string;
  expected:
    | {
        kind: 'allow';
      }
    | {
        kind: 'deny';
        reason: CrossProjectPolicyViolationReason;
      };
};

const raw = (value: string): RawHeader => ({
  kind: 'raw',
  value,
});

const isRawHeader = (value: HeaderInput): value is RawHeader =>
  Boolean(
    value &&
      typeof value === 'object' &&
      'kind' in value &&
      value.kind === 'raw',
  );

const encodeHeader = (value: HeaderInput): string =>
  isRawHeader(value) ? value.value : JSON.stringify(value);

const validEnvelope = {
  requestId: 'crm.producer-a',
};

const validOperationContext = 'crm.producer-a:GET:/api/customer';

const validDetail = {
  requestId: 'crm.producer-a',
  operationId: validOperationContext,
  method: 'GET',
  routePath: '/api/customer',
  schemaHash: 'schema-1',
  operationVersion: 1,
};

const strictContractConfig = {
  enabled: true,
  expectedOperationContracts: {
    'GET:/api/customer': {
      schemaHash: 'schema-1',
      operationVersion: 1,
    },
  },
} satisfies CrossProjectPolicyConfig;

const verifyProducerHeader = (headers: Record<string, unknown>) =>
  typeof headers[VERIFIED_PRODUCER_HEADER] === 'string'
    ? headers[VERIFIED_PRODUCER_HEADER]
    : undefined;

const buildHeaders = ({
  headers,
  envelope,
  operationContext,
  detail,
}: Pick<
  PolicyMatrixScenario,
  'headers' | 'envelope' | 'operationContext' | 'detail'
>): Record<string, unknown> => {
  const result: Record<string, unknown> = {
    ...headers,
  };

  const envelopeInput = envelope ?? validEnvelope;
  if (envelopeInput !== OMIT) {
    result[ENVELOPE_HEADER] = encodeHeader(envelopeInput);
  }

  const operationContextInput = operationContext ?? validOperationContext;
  if (operationContextInput !== OMIT) {
    result[OPERATION_CONTEXT_HEADER] = operationContextInput;
  }

  const detailInput = detail ?? validDetail;
  if (detailInput !== OMIT) {
    result[OPERATION_CONTEXT_DETAIL_HEADER] = encodeHeader(detailInput);
  }

  return result;
};

const withNodeEnv = <T>(nodeEnv: string | undefined, callback: () => T): T => {
  if (!nodeEnv) {
    return callback();
  }

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

const denialReasonCoverage: Record<CrossProjectPolicyViolationReason, true> = {
  invalid_envelope: true,
  invalid_operation_context_details: true,
  missing_envelope: true,
  missing_operation_context: true,
  missing_operation_context_details: true,
  missing_operation_schema_hash: true,
  missing_operation_version: true,
  missing_request_id: true,
  namespace_not_allowed: true,
  operation_context_details_request_id_mismatch: true,
  operation_context_mismatch: true,
  operation_schema_hash_mismatch: true,
  operation_version_mismatch: true,
  producer_identity_mismatch: true,
  unknown_operation_contract: true,
};

const policyMatrix = [
  {
    name: 'allow: full valid context with verified namespace and contract',
    headers: {
      [VERIFIED_PRODUCER_HEADER]: 'crm',
    },
    config: {
      ...strictContractConfig,
      allowedNamespaces: ['crm'],
      verifyProducerIdentity: verifyProducerHeader,
    },
    expected: {
      kind: 'allow',
    },
  },
  {
    name: 'allow: valid context with optional detail operationId omitted',
    detail: {
      requestId: 'crm.producer-a',
      method: 'GET',
      routePath: '/api/customer',
      schemaHash: 'schema-1',
      operationVersion: 1,
    },
    config: strictContractConfig,
    expected: {
      kind: 'allow',
    },
  },
  {
    name: 'deny: envelope header missing',
    envelope: OMIT,
    config: strictContractConfig,
    expected: {
      kind: 'deny',
      reason: 'missing_envelope',
    },
  },
  {
    name: 'deny: envelope header is not JSON',
    envelope: raw('not-json'),
    config: strictContractConfig,
    expected: {
      kind: 'deny',
      reason: 'invalid_envelope',
    },
  },
  {
    name: 'deny: envelope header JSON is not an object',
    envelope: 123,
    config: strictContractConfig,
    expected: {
      kind: 'deny',
      reason: 'invalid_envelope',
    },
  },
  {
    name: 'deny: envelope requestId missing',
    envelope: {},
    config: strictContractConfig,
    expected: {
      kind: 'deny',
      reason: 'missing_request_id',
    },
  },
  {
    name: 'deny: namespace outside verified allowlist',
    headers: {
      [VERIFIED_PRODUCER_HEADER]: 'billing',
    },
    envelope: {
      requestId: 'billing.producer-a',
    },
    operationContext: 'billing.producer-a:GET:/api/customer',
    detail: {
      requestId: 'billing.producer-a',
      operationId: 'billing.producer-a:GET:/api/customer',
      method: 'GET',
      routePath: '/api/customer',
      schemaHash: 'schema-1',
      operationVersion: 1,
    },
    config: {
      ...strictContractConfig,
      allowedNamespaces: ['crm'],
      verifyProducerIdentity: verifyProducerHeader,
    },
    expected: {
      kind: 'deny',
      reason: 'namespace_not_allowed',
    },
  },
  {
    name: 'deny: producer identity cannot be verified',
    config: {
      ...strictContractConfig,
      verifyProducerIdentity: () => undefined,
    },
    expected: {
      kind: 'deny',
      reason: 'producer_identity_mismatch',
    },
  },
  {
    name: 'deny: producer identity does not match envelope namespace',
    headers: {
      [VERIFIED_PRODUCER_HEADER]: 'billing',
    },
    config: {
      ...strictContractConfig,
      verifyProducerIdentity: verifyProducerHeader,
    },
    expected: {
      kind: 'deny',
      reason: 'producer_identity_mismatch',
    },
  },
  {
    name: 'deny: production allowlist without producer verifier fails closed',
    config: {
      enabled: true,
      allowedNamespaces: ['crm'],
      requireOperationContext: false,
    },
    nodeEnv: 'production',
    expected: {
      kind: 'deny',
      reason: 'producer_identity_mismatch',
    },
  },
  {
    name: 'deny: operation context header missing',
    operationContext: OMIT,
    config: strictContractConfig,
    expected: {
      kind: 'deny',
      reason: 'missing_operation_context',
    },
  },
  {
    name: 'deny: operation context requestId does not match envelope',
    operationContext: 'billing.producer-a:GET:/api/customer',
    config: strictContractConfig,
    expected: {
      kind: 'deny',
      reason: 'operation_context_mismatch',
    },
  },
  {
    name: 'deny: operation context details header missing',
    detail: OMIT,
    config: strictContractConfig,
    expected: {
      kind: 'deny',
      reason: 'missing_operation_context_details',
    },
  },
  {
    name: 'deny: operation context details header is not JSON',
    detail: raw('not-json'),
    config: strictContractConfig,
    expected: {
      kind: 'deny',
      reason: 'invalid_operation_context_details',
    },
  },
  {
    name: 'deny: operation context details JSON is not an object',
    detail: ['not-an-object'],
    config: strictContractConfig,
    expected: {
      kind: 'deny',
      reason: 'invalid_operation_context_details',
    },
  },
  {
    name: 'deny: operation context details requestId mismatch',
    detail: {
      ...validDetail,
      requestId: 'billing.producer-a',
    },
    config: strictContractConfig,
    expected: {
      kind: 'deny',
      reason: 'operation_context_details_request_id_mismatch',
    },
  },
  {
    name: 'deny: operation context detail operationId conflicts with header',
    detail: {
      requestId: 'crm.producer-a',
      operationId: 'crm.producer-a:GET:/api/invoice',
      method: 'GET',
      routePath: '/api/invoice',
      schemaHash: 'schema-invoice',
      operationVersion: 1,
    },
    config: {
      enabled: true,
      expectedOperationContracts: {
        'GET:/api/invoice': {
          schemaHash: 'schema-invoice',
          operationVersion: 1,
        },
      },
    },
    expected: {
      kind: 'deny',
      reason: 'operation_context_mismatch',
    },
  },
  {
    name: 'deny: operation schema hash missing',
    detail: {
      requestId: 'crm.producer-a',
      operationId: validOperationContext,
      method: 'GET',
      routePath: '/api/customer',
      operationVersion: 1,
    },
    config: strictContractConfig,
    expected: {
      kind: 'deny',
      reason: 'missing_operation_schema_hash',
    },
  },
  {
    name: 'deny: operation schema hash mismatches contract',
    detail: {
      ...validDetail,
      schemaHash: 'schema-actual',
    },
    config: {
      enabled: true,
      expectedOperationContracts: {
        'GET:/api/customer': {
          schemaHash: 'schema-expected',
          operationVersion: 1,
        },
      },
    },
    expected: {
      kind: 'deny',
      reason: 'operation_schema_hash_mismatch',
    },
  },
  {
    name: 'deny: operation version missing',
    detail: {
      requestId: 'crm.producer-a',
      operationId: validOperationContext,
      method: 'GET',
      routePath: '/api/customer',
      schemaHash: 'schema-1',
    },
    config: strictContractConfig,
    expected: {
      kind: 'deny',
      reason: 'missing_operation_version',
    },
  },
  {
    name: 'deny: operation version mismatches contract',
    detail: {
      ...validDetail,
      operationVersion: 2,
    },
    config: strictContractConfig,
    expected: {
      kind: 'deny',
      reason: 'operation_version_mismatch',
    },
  },
  {
    name: 'deny: unknown operation contract',
    operationContext: 'crm.producer-a:GET:/api/unknown',
    detail: {
      requestId: 'crm.producer-a',
      operationId: 'crm.producer-a:GET:/api/unknown',
      method: 'GET',
      routePath: '/api/unknown',
      schemaHash: 'schema-1',
      operationVersion: 1,
    },
    config: strictContractConfig,
    expected: {
      kind: 'deny',
      reason: 'unknown_operation_contract',
    },
  },
  {
    name: 'deny: empty operation contract map fails closed',
    config: {
      enabled: true,
      expectedOperationContracts: {},
    },
    expected: {
      kind: 'deny',
      reason: 'unknown_operation_contract',
    },
  },
] satisfies PolicyMatrixScenario[];

describe('cross-project policy matrix', () => {
  test('covers every current denial reason', () => {
    const expectedReasons = Object.keys(denialReasonCoverage).sort();
    const coveredReasons = [
      ...new Set(
        policyMatrix.flatMap(scenario =>
          scenario.expected.kind === 'deny' ? [scenario.expected.reason] : [],
        ),
      ),
    ].sort();

    expect(coveredReasons).toEqual(expectedReasons);
  });

  test('has unique scenario names', () => {
    const names = policyMatrix.map(scenario => scenario.name);

    expect(new Set(names).size).toBe(names.length);
  });

  for (const scenario of policyMatrix) {
    test(scenario.name, () => {
      const violation = withNodeEnv(scenario.nodeEnv, () =>
        evaluateCrossProjectPolicy(buildHeaders(scenario), scenario.config),
      );

      if (scenario.expected.kind === 'allow') {
        expect(violation).toBeNull();
      } else {
        expect(violation?.reason).toBe(scenario.expected.reason);
      }
    });
  }
});
