import {
  DataProtocolError,
  parsePublicData,
  serializePublicData,
} from '@modern-js/renderer-core/data';
import { RouteDataError } from '@modern-js/renderer-core/router';
import {
  projectRouteDataError,
  restoreRouteDataError,
} from '../../src/route-data-error';

function createError(
  data: unknown = { field: 'email', message: 'Invalid email' },
) {
  return new RouteDataError('routes/item', {
    kind: 'error',
    status: 422,
    error: { name: 'ValidationError', message: 'Please fix this form' },
    data,
    thrown: true,
  });
}

function createSnapshot() {
  return projectRouteDataError(createError());
}

describe('public RouteDataError projection', () => {
  test('a 422 form error survives the actual public codec and returns to its known boundary class', () => {
    const original = createError();
    const snapshot = projectRouteDataError(original);
    expect(snapshot).toEqual({
      kind: 'ultramodern-route-data-error',
      version: 1,
      routeId: 'routes/item',
      status: 422,
      data: { field: 'email', message: 'Invalid email' },
      error: { name: 'ValidationError', message: 'Please fix this form' },
    });
    const restored = restoreRouteDataError(
      parsePublicData(serializePublicData(snapshot)),
    );
    expect(Object.getPrototypeOf(restored)).toBe(RouteDataError.prototype);
    expect(restored).toBeInstanceOf(Error);
    expect(restored.status).toBe(422);
    expect(restored.routeId).toBe(original.routeId);
    expect(restored.data).toEqual(original.data);
    expect(restored.name).toBe('ValidationError');
    expect(restored.message).toBe('Please fix this form');
  });

  test('the constructor accepts a normalized response outcome without changing its status', () => {
    const original = new RouteDataError('routes/item', {
      kind: 'error',
      error: { name: 'PublicConflict', message: 'This item already exists' },
      data: { duplicate: true },
      thrown: false,
      response: {
        status: 409,
        statusText: 'Conflict',
        headers: [],
        cachePolicy: 'no-store',
      },
    });
    expect(projectRouteDataError(original)).toMatchObject({
      status: 409,
      data: { duplicate: true },
      error: { name: 'PublicConflict', message: 'This item already exists' },
    });
  });

  test('only a controlled own string stack enters development snapshots', () => {
    const original = createError();
    Object.defineProperty(original, 'stack', {
      value: 'ValidationError: public development diagnostic',
      configurable: true,
      writable: true,
    });
    expect(projectRouteDataError(original).error).not.toHaveProperty('stack');
    const development = projectRouteDataError(original, false);
    expect(development.error.stack).toBe(
      'ValidationError: public development diagnostic',
    );
    expect(restoreRouteDataError(development).stack).toBe(
      development.error.stack,
    );
  });

  test('native or user-defined lazy stack accessors are never evaluated', () => {
    const original = createError();
    let getterCalls = 0;
    Object.defineProperty(original, 'stack', {
      get() {
        getterCalls += 1;
        throw new Error('A stack accessor must not run');
      },
      configurable: true,
    });
    expect(projectRouteDataError(original).error).not.toHaveProperty('stack');
    expect(projectRouteDataError(original, false).error).not.toHaveProperty(
      'stack',
    );
    expect(getterCalls).toBe(0);
  });

  test.each([
    'routeId',
    'status',
    'data',
    'name',
    'message',
  ])('a declared %s accessor rejects without invoking it', field => {
    const original = createError();
    let getterCalls = 0;
    Object.defineProperty(original, field, {
      get() {
        getterCalls += 1;
        return 'ULTRA_PRIVATE_ERROR_TOKEN';
      },
      configurable: true,
    });
    expect(() => projectRouteDataError(original)).toThrow(DataProtocolError);
    expect(getterCalls).toBe(0);
  });

  test.each([
    ['Request', () => new Request('https://private.test/')],
    ['Headers', () => new Headers({ authorization: 'private' })],
    ['class', () => new (class PrivateContext {})()],
    ['function', () => () => 'private'],
    ['Promise', () => Promise.resolve('private')],
  ] as const)('%s cannot enter the public boundary data', (_name, value) => {
    expect(() => projectRouteDataError(createError(value()))).toThrow(
      DataProtocolError,
    );
    expect(() =>
      restoreRouteDataError({ ...createSnapshot(), data: value() }),
    ).toThrow(DataProtocolError);
  });

  test('a nested boundary-data accessor rejects without reading it', () => {
    let getterCalls = 0;
    const data = Object.defineProperty({}, 'token', {
      get() {
        getterCalls += 1;
        return 'private';
      },
    });
    expect(() => projectRouteDataError(createError(data))).toThrow(
      DataProtocolError,
    );
    expect(getterCalls).toBe(0);
  });

  test('an arbitrary error or a subclass cannot claim the exact route error tag', () => {
    class PrivateRouteError extends RouteDataError {}
    const outcome = {
      kind: 'error' as const,
      status: 422,
      error: { name: 'ValidationError', message: 'Public message' },
      thrown: true,
    };
    expect(() => projectRouteDataError(new Error('arbitrary'))).toThrow(
      DataProtocolError,
    );
    expect(() =>
      projectRouteDataError(new PrivateRouteError('item', outcome)),
    ).toThrow(DataProtocolError);
    expect(() => projectRouteDataError(createSnapshot())).toThrow(
      DataProtocolError,
    );
  });

  test.each([
    'context',
    'cause',
    'internal',
    'toJSON',
  ])('an extra own %s field is refused even if its value looks public', field => {
    const original = createError();
    Object.defineProperty(original, field, { value: 'must not transfer' });
    expect(() => projectRouteDataError(original)).toThrow(DataProtocolError);
  });

  test('an extra own symbol is refused', () => {
    const original = createError();
    Object.defineProperty(original, Symbol('private'), { value: 'private' });
    expect(() => projectRouteDataError(original)).toThrow(DataProtocolError);
  });

  test.each([
    { kind: 'other' },
    { version: 2 },
    { routeId: '' },
    { routeId: 7 },
    { status: 199 },
    { status: 600 },
    { status: 422.5 },
    { status: Number.NaN },
    { error: { name: 2, message: 'public' } },
    { error: { name: 'Public', message: {} } },
    { error: { name: 'Public', message: 'public', stack: {} } },
    { error: { name: 'Public', message: 'public', cause: 'undeclared' } },
    { context: 'undeclared' },
  ])('a tampered snapshot is rejected: %j', replacement => {
    expect(() =>
      restoreRouteDataError({ ...createSnapshot(), ...replacement }),
    ).toThrow(DataProtocolError);
  });

  test('missing declared fields and nonplain records are refused', () => {
    const snapshot = createSnapshot();
    const missing = { ...snapshot };
    Reflect.deleteProperty(missing, 'data');
    expect(() => restoreRouteDataError(missing)).toThrow(DataProtocolError);
    expect(() =>
      restoreRouteDataError(Object.assign(new Date(), snapshot)),
    ).toThrow(DataProtocolError);
    expect(() =>
      restoreRouteDataError({ ...snapshot, error: new Error('public') }),
    ).toThrow(DataProtocolError);
    expect(() => restoreRouteDataError(null)).toThrow(DataProtocolError);
  });

  test('snapshot and nested diagnostic accessors reject without evaluating either', () => {
    let getterCalls = 0;
    const snapshot = createSnapshot();
    Object.defineProperty(snapshot, 'data', {
      get() {
        getterCalls += 1;
        return 'private';
      },
    });
    expect(() => restoreRouteDataError(snapshot)).toThrow(DataProtocolError);
    const nested = createSnapshot();
    Object.defineProperty(nested.error, 'stack', {
      get() {
        getterCalls += 1;
        return 'private';
      },
    });
    expect(() => restoreRouteDataError(nested)).toThrow(DataProtocolError);
    expect(getterCalls).toBe(0);
  });

  test.each([
    200, 599,
  ])('the public ABI status boundary %i is preserved', status => {
    const snapshot = { ...createSnapshot(), status };
    expect(restoreRouteDataError(snapshot).status).toBe(status);
  });
});
