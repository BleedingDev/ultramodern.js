import 'reflect-metadata';
import {
  buildPositionalHandlerArgs,
  checkCrossProjectPolicy,
  getApiHandlerMode,
  getResponseMetaList,
  getRouteMiddlewares,
  HANDLER_WITH_SCHEMA,
  isSchemaApiHandler,
  mapSchemaHandlerResult,
  planApiRoutes,
  toApiRouteMethod,
} from '../src/adapter-kit';
import {
  assertParityResult,
  createAdapterParityScenarios,
  createParityApiHandlerInfos,
  createParityBffConfig,
  toParityResult,
} from '../src/adapter-kit/parity';
import type { APIHandlerInfo } from '../src/router';
import type { CrossProjectPolicyViolationReason } from '../src/security/crossProjectPolicy';
import { HttpMetadata, HttpMethod, ResponseMetaType } from '../src/types';
import { HANDLER_WITH_META, INPUT_PARAMS_DECIDER } from '../src/utils';

const handlerInfo = (
  overrides: Partial<APIHandlerInfo> & { handler: APIHandlerInfo['handler'] },
): APIHandlerInfo => ({
  name: 'handler',
  httpMethod: HttpMethod.Get,
  routeName: '/route',
  routePath: '/route',
  filename: 'api/index.ts',
  ...overrides,
});

describe('adapter-kit route planning', () => {
  test('maps every HttpMethod onto a lowercase route method', () => {
    expect(Object.values(HttpMethod).map(toApiRouteMethod)).toEqual([
      'get',
      'post',
      'put',
      'delete',
      'connect',
      'trace',
      'patch',
      'options',
      'head',
    ]);
  });

  test('rejects unknown HTTP methods with a descriptive error', () => {
    expect(() =>
      toApiRouteMethod('BREW' as unknown as HttpMethod),
    ).toThrowError(/Unsupported HTTP method "BREW"/);
  });

  test('plans routes preserving registration order and middlewares', () => {
    const middleware = () => undefined;
    const withMiddleware = () => 'a';
    Reflect.defineMetadata('middleware', [middleware], withMiddleware);
    const plain = () => 'b';

    const plan = planApiRoutes([
      handlerInfo({
        handler: withMiddleware,
        httpMethod: HttpMethod.Post,
        routePath: '/a',
      }),
      handlerInfo({ handler: plain, routePath: '/b' }),
    ]);

    expect(plan).toEqual([
      {
        method: 'post',
        routePath: '/a',
        handler: withMiddleware,
        middlewares: [middleware],
      },
      { method: 'get', routePath: '/b', handler: plain, middlewares: [] },
    ]);
  });

  test('ignores non-array middleware metadata', () => {
    const handler = () => 'c';
    Reflect.defineMetadata('middleware', 'not-an-array', handler);
    expect(getRouteMiddlewares(handler)).toEqual([]);
  });
});

describe('adapter-kit handler modes', () => {
  test('detects meta, schema, input-params-decider and plain handlers', () => {
    const meta = Object.assign(() => 'meta', { [HANDLER_WITH_META]: true });
    const schema = Object.assign(() => 'schema', {
      [HANDLER_WITH_SCHEMA]: true,
    });
    const decider = Object.assign(() => 'decider', {
      [INPUT_PARAMS_DECIDER]: true,
    });

    expect(getApiHandlerMode(meta)).toBe('meta');
    expect(getApiHandlerMode(schema)).toBe('schema');
    expect(getApiHandlerMode(decider)).toBe('inputParamsDecider');
    expect(getApiHandlerMode(() => 'plain')).toBe('plain');
  });

  test('meta detection wins over schema detection', () => {
    const both = Object.assign(() => 'both', {
      [HANDLER_WITH_META]: true,
      [HANDLER_WITH_SCHEMA]: true,
    });
    expect(getApiHandlerMode(both)).toBe('meta');
  });

  test('schema marker must be strictly true', () => {
    const marked = Object.assign(() => 'x', { [HANDLER_WITH_SCHEMA]: 1 });
    expect(isSchemaApiHandler(marked)).toBe(false);
    expect(isSchemaApiHandler(undefined)).toBe(false);
  });
});

describe('adapter-kit schema result mapping', () => {
  test('maps success to 200 with the value payload', () => {
    expect(
      mapSchemaHandlerResult({ type: 'HandleSuccess', value: { id: 1 } }),
    ).toEqual({ success: true, status: 200, body: { id: 1 } });
  });

  test('maps input validation errors to 400', () => {
    expect(
      mapSchemaHandlerResult({
        type: 'InputValidationError',
        message: 'bad input',
      }),
    ).toEqual({ success: false, status: 400, body: 'bad input' });
  });

  test('maps other failures to 500', () => {
    expect(
      mapSchemaHandlerResult({
        type: 'OutputValidationError',
        message: 'bad output',
      }),
    ).toEqual({ success: false, status: 500, body: 'bad output' });
  });
});

describe('adapter-kit response meta and args', () => {
  test('returns response meta entries or an empty list', () => {
    const handler = () => 'x';
    expect(getResponseMetaList(handler)).toEqual([]);

    Reflect.defineMetadata(
      HttpMetadata.Response,
      [{ type: ResponseMetaType.StatusCode, value: 201 }],
      handler,
    );
    expect(getResponseMetaList(handler)).toEqual([
      { type: ResponseMetaType.StatusCode, value: 201 },
    ]);
  });

  test('builds positional args from params followed by the input', () => {
    const input = { params: { id: '1', tab: 'x' }, query: {} };
    expect(buildPositionalHandlerArgs(input)).toEqual(['1', 'x', input]);
  });

  test('builds positional args in route declaration order when provided', () => {
    const input = { params: { tab: 'x', id: '1' }, query: {} };
    expect(buildPositionalHandlerArgs(input, '/route/:id/:tab')).toEqual([
      '1',
      'x',
      input,
    ]);
  });
});

describe('adapter-kit policy check', () => {
  test('passes requests through when no policy is configured', () => {
    expect(checkCrossProjectPolicy({}, undefined)).toBeNull();
    expect(checkCrossProjectPolicy({}, { enabled: false })).toBeNull();
  });

  test('maps violations onto the shared HTTP denial shape', () => {
    const denial = checkCrossProjectPolicy({}, { enabled: true });
    expect(denial).toEqual({
      status: 403,
      body: {
        code: 'BFF_CROSS_PROJECT_POLICY_DENIED',
        reason: 'missing_envelope',
        message: expect.stringContaining('x-modernjs-bff-envelope'),
      },
    });
  });
});

describe('adapter-kit parity table', () => {
  test('defines unique scenarios and covers every strict policy denial', () => {
    const scenarios = createAdapterParityScenarios();
    const names = scenarios.map(scenario => scenario.name);
    expect(new Set(names).size).toBe(names.length);

    const denialReasons = scenarios
      .map(scenario => scenario.expected)
      .filter(
        (
          expected,
        ): expected is {
          kind: 'denied';
          status: number;
          reason: CrossProjectPolicyViolationReason;
        } => expected.kind === 'denied',
      )
      .map(expected => expected.reason)
      .sort();

    expect(denialReasons).toEqual(
      [
        'invalid_envelope',
        'invalid_envelope',
        'invalid_operation_context_details',
        'invalid_operation_context_details',
        'missing_envelope',
        'missing_operation_context',
        'missing_operation_context_details',
        'missing_operation_schema_hash',
        'missing_operation_version',
        'missing_request_id',
        'namespace_not_allowed',
        'operation_context_details_request_id_mismatch',
        'operation_context_mismatch',
        'operation_schema_hash_mismatch',
        'operation_version_mismatch',
        'unknown_operation_contract',
      ].sort(),
    );
  });

  test('builds strict policy config and fixture handlers for adapter tests', () => {
    expect(createParityBffConfig()).toEqual({
      requestId: 'crm',
      crossProjectPolicy: {
        enabled: true,
        allowedNamespaces: ['crm'],
        allowClientAssertedNamespace: true,
      },
    });
    expect(createParityApiHandlerInfos().map(handler => handler.name)).toEqual([
      'getHello',
      'postHello',
      'getNothing',
      'postEcho',
      'getItem',
      'patchSchema',
    ]);
  });

  test('normalizes adapter HTTP responses before parity comparison', () => {
    expect(
      toParityResult({
        status: 200,
        type: 'application/json',
        body: { ok: true },
        text: '{"ok":true}',
      }),
    ).toEqual({ status: 200, payload: { ok: true } });
    expect(
      toParityResult({
        status: 200,
        type: 'text/plain',
        body: undefined,
        text: '',
      }),
    ).toEqual({ status: 200, payload: undefined });
  });

  test('asserts payload and denial expectations', () => {
    const [payloadScenario] = createAdapterParityScenarios();
    assertParityResult(payloadScenario!, {
      status: 200,
      type: 'application/json',
      body: { message: 'hello' },
      text: '{"message":"hello"}',
    });

    const deniedScenario = createAdapterParityScenarios().find(
      scenario => scenario.name === 'policy denies missing envelope',
    )!;
    assertParityResult(deniedScenario, {
      status: 403,
      type: 'application/json',
      body: {
        code: 'BFF_CROSS_PROJECT_POLICY_DENIED',
        reason: 'missing_envelope',
        message: 'missing',
      },
      text: '',
    });

    const driftScenario = createAdapterParityScenarios().find(
      scenario => scenario.name === 'plain handler returning undefined',
    )!;
    assertParityResult(driftScenario, {
      status: 404,
      type: 'text/plain',
      body: undefined,
      text: '404 Not Found',
    });
  });
});
