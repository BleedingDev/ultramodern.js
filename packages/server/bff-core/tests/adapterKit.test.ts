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
import type { APIHandlerInfo } from '../src/router';
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
