import {
  type CrossProjectOperationContract,
  evaluateCrossProjectPolicy,
  resolveCrossProjectRequestObservation,
} from '../../src/bff-policy/crossProjectPolicy';
import { buildOperationContractMap } from '../../src/bff-policy/operationContracts';

// Header/reason permutations live in crossProjectPolicy.matrix.test.ts.
// This file only covers behaviour that matrix cannot express: binding a
// contract to the *observed* request.
describe('cross-project policy', () => {
  test('denies operation metadata that does not match the observed request', () => {
    const contracts = buildOperationContractMap({
      handlers: [
        { name: 'getCustomer', httpMethod: 'GET', routePath: '/api/customer' },
        {
          name: 'createInvoice',
          httpMethod: 'POST',
          routePath: '/api/invoice',
        },
      ],
      requestId: 'crm.producer-a',
    });
    const forgedContract = contracts['POST:/api/invoice']!;

    const violation = evaluateCrossProjectPolicy(
      {
        'x-modernjs-bff-envelope': JSON.stringify({
          requestId: forgedContract.requestId,
        }),
        'x-operation-id': forgedContract.operationId,
        'x-modernjs-bff-operation-context': JSON.stringify(forgedContract),
      },
      { enabled: true, expectedOperationContracts: contracts },
      { method: 'GET', routePath: '/api/customer' },
    );

    expect(violation?.reason).toBe('operation_context_mismatch');
  });

  test('binds operation identity when a manual contract omits operationId', () => {
    const requestId = 'crm.producer-a';
    const violation = evaluateCrossProjectPolicy(
      {
        'x-modernjs-bff-envelope': JSON.stringify({ requestId }),
        'x-operation-id': `${requestId}:forged-operation`,
        'x-modernjs-bff-operation-context': JSON.stringify({
          requestId,
          operationId: `${requestId}:forged-operation`,
          method: 'GET',
          routePath: '/api/customer',
          schemaHash: 'schema-customer',
          operationVersion: 1,
        }),
      },
      {
        enabled: true,
        expectedOperationContracts: {
          'GET:/api/customer': {
            schemaHash: 'schema-customer',
            operationVersion: 1,
          },
        },
      },
      { method: 'GET', routePath: '/api/customer' },
    );

    expect(violation?.reason).toBe('operation_context_mismatch');
  });

  test('allows unknown operation contracts when allowUnknownOperations is true', () => {
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
          'GET:/api/customer': { schemaHash: 'schema-1', operationVersion: 1 },
        },
      },
    );

    expect(violation).toBeNull();
  });
});

describe('cross-project request observation', () => {
  const resolve = (
    pathname: string,
    expectedOperationContracts: Record<string, CrossProjectOperationContract>,
    method = 'GET',
  ) =>
    resolveCrossProjectRequestObservation(
      { method, pathname },
      { expectedOperationContracts },
    );

  test('fails closed when two route templates have the same specificity', () => {
    expect(
      resolve('/foo/42', {
        'GET:/api/:entity/42': {},
        'GET:/api/foo/:id': {},
      }),
    ).toEqual({ method: 'GET', routePath: '/foo/42' });
  });

  test('does not strip a dynamic mount prefix', () => {
    expect(
      resolve('/products/42', { 'GET:/api/:tenant/products/:id': {} }),
    ).toEqual({ method: 'GET', routePath: '/products/42' });
  });

  test('fails closed for a nonterminal wildcard template', () => {
    expect(resolve('/anything/admin', { 'GET:/api/*/admin': {} })).toEqual({
      method: 'GET',
      routePath: '/anything/admin',
    });
  });

  test.each(['/files/a%2Fb', '/files/%ZZ'])(
    'fails closed for ambiguous or malformed percent encoding in %s',
    pathname => {
      expect(resolve(pathname, { 'GET:/api/files/:id': {} })).toEqual({
        method: 'GET',
        routePath: pathname,
      });
    },
  );

  test('preserves trailing-slash distinctions while accepting an exact trailing template', () => {
    expect(resolve('/products/42/', { 'GET:/api/products/:id': {} })).toEqual({
      method: 'GET',
      routePath: '/products/42/',
    });
    expect(resolve('/products/42/', { 'GET:/api/products/:id/': {} })).toEqual({
      method: 'GET',
      routePath: '/api/products/:id/',
    });
  });

  test('binds a mounted root request to the fixed producer prefix', () => {
    expect(resolve('/', { 'GET:/api': {} })).toEqual({
      method: 'GET',
      routePath: '/api',
    });
  });

  test('denies a GET contract sent to a same-route POST operation', () => {
    const contracts = buildOperationContractMap({
      handlers: [
        {
          name: 'getProduct',
          httpMethod: 'GET',
          routePath: '/api/products/:id',
        },
        {
          name: 'updateProduct',
          httpMethod: 'POST',
          routePath: '/api/products/:id',
        },
      ],
      requestId: 'catalog.producer-a',
    });
    const getContract = contracts['GET:/api/products/:id']!;
    const observedRequest = resolveCrossProjectRequestObservation(
      { method: 'POST', pathname: '/products/42' },
      { expectedOperationContracts: contracts },
    );

    const violation = evaluateCrossProjectPolicy(
      {
        'x-modernjs-bff-envelope': JSON.stringify({
          requestId: getContract.requestId,
        }),
        'x-operation-id': getContract.operationId,
        'x-modernjs-bff-operation-context': JSON.stringify(getContract),
      },
      { enabled: true, expectedOperationContracts: contracts },
      observedRequest,
    );

    expect(violation?.reason).toBe('operation_context_mismatch');
  });
});
