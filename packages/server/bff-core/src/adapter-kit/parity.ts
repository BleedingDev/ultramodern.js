import type { APIHandlerInfo } from '../router';
import type { CrossProjectPolicyViolationReason } from '../security/crossProjectPolicy';
import { buildOperationContractMap } from '../security/operationContracts';
import { HttpMethod } from '../types';

/**
 * Adapter parity (conformance) kit.
 *
 * One shared table of scenarios executed against every BFF server adapter
 * in its own test harness. Each scenario asserts the adapters produce
 * identical observable results: HTTP status, payload value and
 * policy-rejection reason.
 *
 * The express/koa adapters were removed from the fork; their expectations
 * are retained in the per-adapter drift pins as documentation of the
 * historical behavior. The live consumer of this table is the hono lane
 * (`@modern-js/plugin-bff` runs it against `createHonoRoutes` plus the
 * cross-project policy middleware).
 *
 * Transport details intentionally NOT asserted: express serialized scalar
 * bodies as JSON while koa sent `text/plain`; {@link toParityResult}
 * normalizes both to the decoded payload value before comparison.
 *
 * Intentionally OUT OF SCOPE (known, accepted adapter drift — do not add
 * scenarios without deciding the drift first):
 * - operator route-middlewares: express applied them, koa ignored them;
 * - multipart/form-data: payload shapes differ per body parser;
 * - undefined-returning plain handlers are pinned via a per-adapter
 *   scenario below: express ended the response 200/empty, koa served its
 *   stock 404 ("Not Found"), hono serves its stock "404 Not Found";
 * - farrow schema-mode handlers are pinned per-adapter below: express/koa
 *   unwrapped the result envelope (200/400/500), the hono lane has no
 *   schema-mode unwrapping and passes the raw envelope through.
 */

export const PARITY_REQUEST_ID = 'crm';
export const PARITY_PRODUCER_REQUEST_ID = 'crm.producer-a';
const PARITY_FIXTURE_FILENAME = 'bff-core/adapter-kit/parity-fixture.ts';

const HANDLER_WITH_SCHEMA = 'HANDLER_WITH_SCHEMA';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

const createSchemaFixtureHandler = (): APIHandlerInfo['handler'] => {
  const handler = (input: unknown) => {
    const data =
      isRecord(input) && isRecord(input.data) ? input.data : undefined;
    const id = data?.id;
    if (typeof id === 'number') {
      return { type: 'HandleSuccess', value: { id } };
    }
    if (id === 'boom') {
      return { type: 'OutputValidationError', message: 'invalid output' };
    }
    return { type: 'InputValidationError', message: 'invalid input' };
  };
  return Object.assign(handler, { [HANDLER_WITH_SCHEMA]: true });
};

/**
 * Handler fixtures registered in both adapters before running the table.
 */
export const createParityApiHandlerInfos = (): APIHandlerInfo[] => [
  {
    name: 'getHello',
    httpMethod: HttpMethod.Get,
    routeName: '/hello',
    routePath: '/hello',
    filename: PARITY_FIXTURE_FILENAME,
    handler: () => ({ message: 'hello' }),
  },
  {
    name: 'postHello',
    httpMethod: HttpMethod.Post,
    routeName: '/hello',
    routePath: '/hello',
    filename: PARITY_FIXTURE_FILENAME,
    handler: () => 'hello',
  },
  {
    name: 'getNothing',
    httpMethod: HttpMethod.Get,
    routeName: '/nothing',
    routePath: '/nothing',
    filename: PARITY_FIXTURE_FILENAME,
    handler: () => undefined,
  },
  {
    name: 'postEcho',
    httpMethod: HttpMethod.Post,
    routeName: '/echo',
    routePath: '/echo',
    filename: PARITY_FIXTURE_FILENAME,
    handler: (input: unknown) => {
      const normalized = isRecord(input) ? input : {};
      return {
        data: normalized.data ?? null,
        query: normalized.query ?? {},
        cookie: normalized.cookies ?? null,
      };
    },
  },
  {
    name: 'getItem',
    httpMethod: HttpMethod.Get,
    routeName: '/items/:id',
    routePath: '/items/:id',
    filename: PARITY_FIXTURE_FILENAME,
    handler: (id: unknown, input: unknown) => ({
      id,
      query: isRecord(input) ? (input.query ?? {}) : {},
    }),
  },
  {
    name: 'patchSchema',
    httpMethod: HttpMethod.Patch,
    routeName: '/schema',
    routePath: '/schema',
    filename: PARITY_FIXTURE_FILENAME,
    handler: createSchemaFixtureHandler(),
  },
];

/**
 * `bff` config slice for the policy-enabled parity server. All `require*`
 * switches stay at their strict defaults.
 */
export const createParityBffConfig = () => ({
  requestId: PARITY_REQUEST_ID,
  crossProjectPolicy: {
    enabled: true,
    allowedNamespaces: [PARITY_REQUEST_ID],
  },
});

const getParityContracts = () =>
  buildOperationContractMap({
    handlers: createParityApiHandlerInfos(),
    requestId: PARITY_REQUEST_ID,
  });

const envelopeHeader = (requestId: unknown) =>
  JSON.stringify(requestId === undefined ? {} : { requestId });

const detailHeader = (details: Record<string, unknown>) =>
  JSON.stringify(details);

export type ParityAdapterId = 'express' | 'koa' | 'hono';

export type ParityExpectation =
  | { kind: 'payload'; status: number; payload: unknown }
  | {
      kind: 'denied';
      status: number;
      reason: CrossProjectPolicyViolationReason;
    }
  | {
      /** Pinned, intentional adapter drift: each adapter has its own expectation. */
      kind: 'perAdapter';
      expectations: Record<
        ParityAdapterId,
        { status: number; payload: unknown }
      >;
    };

export type AdapterParityScenario = {
  name: string;
  /** Run against the policy-enabled server instead of the open one. */
  policy: boolean;
  request: {
    method: 'get' | 'post' | 'patch';
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
  };
  expected: ParityExpectation;
};

const deniedScenario = (
  name: string,
  reason: CrossProjectPolicyViolationReason,
  headers: Record<string, string>,
): AdapterParityScenario => ({
  name,
  policy: true,
  request: { method: 'get', path: '/hello', headers },
  expected: { kind: 'denied', status: 403, reason },
});

export const createAdapterParityScenarios = (): AdapterParityScenario[] => {
  const contracts = getParityContracts();
  const helloContract = contracts['GET:/hello'];
  const validEnvelope = envelopeHeader(PARITY_PRODUCER_REQUEST_ID);
  const validOperationId = `${PARITY_PRODUCER_REQUEST_ID}:parity`;

  return [
    {
      name: 'plain handler returns object payload',
      policy: false,
      request: { method: 'get', path: '/hello' },
      expected: { kind: 'payload', status: 200, payload: { message: 'hello' } },
    },
    {
      name: 'plain handler returns scalar payload',
      policy: false,
      request: { method: 'post', path: '/hello' },
      expected: { kind: 'payload', status: 200, payload: 'hello' },
    },
    {
      name: 'plain handler returning undefined (pinned adapter drift)',
      policy: false,
      request: { method: 'get', path: '/nothing' },
      expected: {
        kind: 'perAdapter',
        expectations: {
          express: { status: 200, payload: undefined },
          koa: { status: 404, payload: 'Not Found' },
          hono: { status: 404, payload: '404 Not Found' },
        },
      },
    },
    {
      name: 'plain handler receives data, query and cookies',
      policy: false,
      request: {
        method: 'post',
        path: '/echo?q=z',
        headers: {
          'content-type': 'application/json',
          cookie: 'id=666',
        },
        body: { a: 1 },
      },
      expected: {
        kind: 'payload',
        status: 200,
        payload: { data: { a: 1 }, query: { q: 'z' }, cookie: 'id=666' },
      },
    },
    {
      name: 'plain handler receives positional route params',
      policy: false,
      request: { method: 'get', path: '/items/123?q=x' },
      expected: {
        kind: 'payload',
        status: 200,
        payload: { id: '123', query: { q: 'x' } },
      },
    },
    {
      name: 'schema handler success (pinned adapter drift)',
      policy: false,
      request: {
        method: 'patch',
        path: '/schema',
        headers: { 'content-type': 'application/json' },
        body: { id: 777 },
      },
      expected: {
        kind: 'perAdapter',
        expectations: {
          express: { status: 200, payload: { id: 777 } },
          koa: { status: 200, payload: { id: 777 } },
          // The hono lane has no farrow schema-mode unwrapping: the raw
          // result envelope is passed through as JSON.
          hono: {
            status: 200,
            payload: { type: 'HandleSuccess', value: { id: 777 } },
          },
        },
      },
    },
    {
      name: 'schema handler input validation error (pinned adapter drift)',
      policy: false,
      request: {
        method: 'patch',
        path: '/schema',
        headers: { 'content-type': 'application/json' },
        body: { id: 'aaa' },
      },
      expected: {
        kind: 'perAdapter',
        expectations: {
          express: { status: 400, payload: 'invalid input' },
          koa: { status: 400, payload: 'invalid input' },
          hono: {
            status: 200,
            payload: { type: 'InputValidationError', message: 'invalid input' },
          },
        },
      },
    },
    {
      name: 'schema handler output validation error (pinned adapter drift)',
      policy: false,
      request: {
        method: 'patch',
        path: '/schema',
        headers: { 'content-type': 'application/json' },
        body: { id: 'boom' },
      },
      expected: {
        kind: 'perAdapter',
        expectations: {
          express: { status: 500, payload: 'invalid output' },
          koa: { status: 500, payload: 'invalid output' },
          hono: {
            status: 200,
            payload: {
              type: 'OutputValidationError',
              message: 'invalid output',
            },
          },
        },
      },
    },
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
    deniedScenario('policy denies missing envelope', 'missing_envelope', {}),
    deniedScenario('policy denies invalid envelope', 'invalid_envelope', {
      'x-modernjs-bff-envelope': 'not-json',
    }),
    deniedScenario(
      'policy denies envelope that is valid JSON but not an object',
      'invalid_envelope',
      {
        'x-modernjs-bff-envelope': '123',
      },
    ),
    deniedScenario('policy denies missing requestId', 'missing_request_id', {
      'x-modernjs-bff-envelope': envelopeHeader(undefined),
    }),
    deniedScenario(
      'policy denies namespace outside allowlist',
      'namespace_not_allowed',
      {
        'x-modernjs-bff-envelope': envelopeHeader('billing.producer-z'),
      },
    ),
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
      'policy denies unknown operation contract',
      'unknown_operation_contract',
      {
        'x-modernjs-bff-envelope': validEnvelope,
        'x-operation-id': validOperationId,
        'x-modernjs-bff-operation-context': detailHeader({
          requestId: PARITY_PRODUCER_REQUEST_ID,
          method: 'GET',
          routePath: '/does-not-exist',
          schemaHash: helloContract.schemaHash,
          operationVersion: helloContract.operationVersion,
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
          operationVersion: helloContract.operationVersion + 1,
        }),
      },
    ),
  ];
};

/** Structural slice of a supertest response used for normalization. */
export type ParityHttpResponse = {
  status: number;
  /** Content-type mime, e.g. `application/json`. */
  type: string;
  body: unknown;
  text: string;
};

export type AdapterParityResult = {
  status: number;
  payload: unknown;
};

/**
 * Normalizes a raw HTTP response to the observable payload value so JSON
 * (express) and text (koa) encodings of the same scalar compare equal.
 */
export const toParityResult = (
  res: ParityHttpResponse,
): AdapterParityResult => ({
  status: res.status,
  payload: res.type.includes('json')
    ? res.body
    : res.text === ''
      ? undefined
      : res.text,
});

const formatValue = (value: unknown) => JSON.stringify(value);

/**
 * Framework-agnostic assertion: throws a descriptive error when the adapter
 * response deviates from the scenario expectation.
 */
export const assertParityResult = (
  scenario: AdapterParityScenario,
  res: ParityHttpResponse,
  adapter?: ParityAdapterId,
): void => {
  const result = toParityResult(res);
  const failures: string[] = [];
  let { expected } = scenario;

  if (expected.kind === 'perAdapter') {
    if (adapter === undefined) {
      throw new Error(
        `Adapter parity scenario "${scenario.name}" pins per-adapter drift; pass the adapter id to assertParityResult.`,
      );
    }
    expected = { kind: 'payload', ...expected.expectations[adapter] };
  }

  if (result.status !== expected.status) {
    failures.push(
      `status: expected ${expected.status}, received ${result.status}`,
    );
  }

  if (expected.kind === 'payload') {
    if (formatValue(result.payload) !== formatValue(expected.payload)) {
      failures.push(
        `payload: expected ${formatValue(expected.payload)}, received ${formatValue(result.payload)}`,
      );
    }
  } else {
    const payload = isRecord(result.payload) ? result.payload : {};
    if (payload.code !== 'BFF_CROSS_PROJECT_POLICY_DENIED') {
      failures.push(
        `denial code: expected "BFF_CROSS_PROJECT_POLICY_DENIED", received ${formatValue(payload.code)}`,
      );
    }
    if (payload.reason !== expected.reason) {
      failures.push(
        `denial reason: expected "${expected.reason}", received ${formatValue(payload.reason)}`,
      );
    }
    if (typeof payload.message !== 'string' || payload.message.length === 0) {
      failures.push(
        `denial message: expected non-empty string, received ${formatValue(payload.message)}`,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Adapter parity scenario "${scenario.name}" failed:\n- ${failures.join('\n- ')}`,
    );
  }
};
