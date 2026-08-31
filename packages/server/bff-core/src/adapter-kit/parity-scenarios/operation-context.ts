import type {
  AdapterParityScenario,
  AdapterParityScenarioContext,
} from './shared';
import {
  deniedScenario,
  detailHeader,
  PARITY_PRODUCER_REQUEST_ID,
} from './shared';

export const createOperationContextSuccessScenarios = ({
  helloContract,
  validEnvelope,
  validOperationId,
}: AdapterParityScenarioContext): AdapterParityScenario[] => [
  {
    name: 'policy pass with full operation context',
    policy: true,
    request: {
      method: 'get',
      path: '/hello',
      headers: {
        'x-modernjs-bff-envelope': validEnvelope,
        'x-operation-id': validOperationId,
        'x-modernjs-bff-operation-context': detailHeader({
          requestId: PARITY_PRODUCER_REQUEST_ID,
          method: 'GET',
          routePath: '/hello',
          schemaHash: helloContract.schemaHash,
          operationVersion: helloContract.operationVersion,
        }),
      },
    },
    expected: { kind: 'payload', status: 200, payload: { message: 'hello' } },
  },
];

const getMismatchedOperationVersion = (
  contract: AdapterParityScenarioContext['helloContract'],
) => {
  const operationVersion = contract.operationVersion;
  if (typeof operationVersion !== 'number') {
    throw new Error('Adapter parity hello contract requires operationVersion');
  }
  return operationVersion + 1;
};

export const createOperationContextDenialScenarios = ({
  helloContract,
  validEnvelope,
  validOperationId,
}: AdapterParityScenarioContext): AdapterParityScenario[] => [
  deniedScenario(
    'policy denies missing operation context',
    'missing_operation_context',
    {
      'x-modernjs-bff-envelope': validEnvelope,
    },
  ),
  deniedScenario(
    'policy denies operation context mismatch',
    'operation_context_mismatch',
    {
      'x-modernjs-bff-envelope': validEnvelope,
      'x-operation-id': 'someone-else:parity',
    },
  ),
  deniedScenario(
    'policy denies missing operation context details',
    'missing_operation_context_details',
    {
      'x-modernjs-bff-envelope': validEnvelope,
      'x-operation-id': validOperationId,
    },
  ),
  deniedScenario(
    'policy denies JSON-array operation context details',
    'invalid_operation_context_details',
    {
      'x-modernjs-bff-envelope': validEnvelope,
      'x-operation-id': validOperationId,
      'x-modernjs-bff-operation-context': '[]',
    },
  ),
  deniedScenario(
    'policy denies invalid operation context details',
    'invalid_operation_context_details',
    {
      'x-modernjs-bff-envelope': validEnvelope,
      'x-operation-id': validOperationId,
      'x-modernjs-bff-operation-context': 'not-json',
    },
  ),
  deniedScenario(
    'policy denies detail requestId mismatch',
    'operation_context_details_request_id_mismatch',
    {
      'x-modernjs-bff-envelope': validEnvelope,
      'x-operation-id': validOperationId,
      'x-modernjs-bff-operation-context': detailHeader({
        requestId: 'crm.producer-b',
        method: 'GET',
        routePath: '/hello',
        schemaHash: helloContract.schemaHash,
        operationVersion: helloContract.operationVersion,
      }),
    },
  ),
  deniedScenario(
    'policy denies missing operation schema hash',
    'missing_operation_schema_hash',
    {
      'x-modernjs-bff-envelope': validEnvelope,
      'x-operation-id': validOperationId,
      'x-modernjs-bff-operation-context': detailHeader({
        requestId: PARITY_PRODUCER_REQUEST_ID,
        method: 'GET',
        routePath: '/hello',
        operationVersion: helloContract.operationVersion,
      }),
    },
  ),
  deniedScenario(
    'policy denies missing operation version',
    'missing_operation_version',
    {
      'x-modernjs-bff-envelope': validEnvelope,
      'x-operation-id': validOperationId,
      'x-modernjs-bff-operation-context': detailHeader({
        requestId: PARITY_PRODUCER_REQUEST_ID,
        method: 'GET',
        routePath: '/hello',
        schemaHash: helloContract.schemaHash,
      }),
    },
  ),
  deniedScenario(
    'policy denies operation schema hash mismatch',
    'operation_schema_hash_mismatch',
    {
      'x-modernjs-bff-envelope': validEnvelope,
      'x-operation-id': validOperationId,
      'x-modernjs-bff-operation-context': detailHeader({
        requestId: PARITY_PRODUCER_REQUEST_ID,
        method: 'GET',
        routePath: '/hello',
        schemaHash: 'deadbeef',
        operationVersion: helloContract.operationVersion,
      }),
    },
  ),
  deniedScenario(
    'policy denies operation version mismatch',
    'operation_version_mismatch',
    {
      'x-modernjs-bff-envelope': validEnvelope,
      'x-operation-id': validOperationId,
      'x-modernjs-bff-operation-context': detailHeader({
        requestId: PARITY_PRODUCER_REQUEST_ID,
        method: 'GET',
        routePath: '/hello',
        schemaHash: helloContract.schemaHash,
        operationVersion: getMismatchedOperationVersion(helloContract),
      }),
    },
  ),
];
