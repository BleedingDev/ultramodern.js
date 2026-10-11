import {
  assertPublicData,
  DataProtocolError,
} from '@modern-js/renderer-core/data';
import {
  type AnySerializationAdapter,
  createSerializationAdapter,
} from '@octanejs/tanstack-router';
import { RouteDataError } from './routes';

export const ADAPTER_KEY = 'ultramodern.octane-public-snapshot.v1';
export const ROUTE_ERROR_KIND = 'ultramodern-route-error';
export const NATIVE_ERROR_KIND = 'ultramodern-native-error';
const nativeErrorTypes: Readonly<Record<string, typeof Error>> = Object.freeze({
  Error,
  TypeError,
  RangeError,
  SyntaxError,
  ReferenceError,
  URIError,
  EvalError,
});
export const NATIVE_ROOT_FIELDS = new Set([
  'manifest',
  'matches',
  'lastMatchId',
  'dehydratedData',
]);
export const MATCH_FIELDS = new Set(['i', 'u', 's', 'b', 'l', 'e', 'ssr', 'g']);
export function invalid(message: string): DataProtocolError {
  const error = new DataProtocolError(`Octane router snapshot: ${message}`);
  // Native Seroval may continue parsing this owned diagnostic after cleanup.
  // Its Error serializer must not request even a lazy native stack accessor.
  delete error.stack;
  return error;
}

export function descriptors(
  value: object,
  allowed?: ReadonlySet<string>,
  allowLazyStack = false,
): Record<string, PropertyDescriptor> {
  const result: Record<string, PropertyDescriptor> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== 'string' || (allowed && !allowed.has(key))) {
      throw invalid('an unsupported own field cannot be transferred');
    }
    if (descriptor.get || descriptor.set) {
      if (key === 'stack' && allowLazyStack) continue;
      throw invalid('accessors cannot be transferred');
    }
    result[key] = descriptor;
  }
  return result;
}

export function record(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

export function stringField(
  fields: Record<string, PropertyDescriptor>,
  key: string,
) {
  const value: unknown = fields[key]?.value;
  if (typeof value !== 'string') throw invalid(`${key} must be a string`);
  return value;
}

export function nativePromise(value: unknown): value is Promise<unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Promise.prototype
  );
}

export function clearStack(error: Error, stack: unknown) {
  delete error.stack;
  if (typeof stack === 'string') {
    Object.defineProperty(error, 'stack', {
      value: stack,
      writable: true,
      configurable: true,
    });
  }
}

function decodeRouteError(error: unknown): unknown {
  if (!record(error)) return error;
  const errorFields = descriptors(error);
  const kind = errorFields['kind']?.value;
  if (kind !== ROUTE_ERROR_KIND && kind !== NATIVE_ERROR_KIND) return error;
  if (kind === NATIVE_ERROR_KIND) {
    descriptors(
      error,
      new Set(['kind', 'type', 'name', 'message', 'stack', 'cause']),
    );
    assertPublicData(error);
    const type = stringField(errorFields, 'type');
    const Constructor = Object.getOwnPropertyDescriptor(nativeErrorTypes, type)
      ?.value as typeof Error | undefined;
    if (!Constructor) throw invalid('the native Error type is unsupported');
    const restored = new Constructor(stringField(errorFields, 'message'));
    clearStack(restored, errorFields['stack']?.value);
    Object.defineProperty(restored, 'name', {
      value: stringField(errorFields, 'name'),
      writable: true,
      configurable: true,
    });
    if (errorFields['cause'])
      Object.defineProperty(restored, 'cause', {
        value: errorFields['cause'].value,
        writable: true,
        configurable: true,
      });
    return restored;
  }
  const expected = new Set([
    'kind',
    'routeId',
    'status',
    'data',
    'name',
    'message',
    'stack',
    'cause',
  ]);
  descriptors(error, expected);
  const routeId = stringField(errorFields, 'routeId');
  const name = stringField(errorFields, 'name');
  const message = stringField(errorFields, 'message');
  const status: unknown = errorFields['status']?.value;
  if (
    !routeId ||
    !Number.isInteger(status) ||
    (status as number) < 400 ||
    (status as number) > 599
  ) {
    throw invalid('a route error has invalid identity or status');
  }
  assertPublicData(error);
  const restored = new RouteDataError(routeId, {
    kind: 'error',
    status: status as number,
    error: { name, message },
    data: errorFields['data']?.value,
    thrown: true,
  });
  clearStack(restored, errorFields['stack']?.value);
  if (errorFields['cause']) {
    Object.defineProperty(restored, 'cause', {
      value: errorFields['cause'].value,
      writable: true,
      configurable: true,
    });
  }
  return restored;
}

/** Native hydrate installs this decoder before replaying adapter-dependent scripts. */
function decodeNativeSnapshot(value: unknown): object {
  if (!record(value)) throw invalid('the native root must be a record');
  const fields = descriptors(value, NATIVE_ROOT_FIELDS);
  const matches: unknown = fields['matches']?.value;
  if (!Array.isArray(matches)) throw invalid('native matches must be an array');
  const matchFields = descriptors(matches);
  const promises = new WeakMap<Promise<unknown>, Promise<unknown>>();
  const loaders = new WeakMap<object, object>();
  const errors = new WeakMap<object, unknown>();
  const decodeError = (error: unknown) => {
    if (error === null || typeof error !== 'object') return error;
    if (errors.has(error)) return errors.get(error);
    const restored = decodeRouteError(error);
    errors.set(error, restored);
    return restored;
  };
  const decodePromise = (promise: Promise<unknown>) => {
    const previous = promises.get(promise);
    if (previous) return previous;
    const restored = Promise.prototype.then.call(
      promise,
      undefined,
      (error: unknown) => {
        throw decodeError(error);
      },
    ) as Promise<unknown>;
    promises.set(promise, restored);
    void Promise.prototype.then.call(restored, undefined, () => {});
    return restored;
  };
  const decodeLoader = (loader: unknown): unknown => {
    if (nativePromise(loader)) return decodePromise(loader);
    if (!record(loader)) return loader;
    const properties = descriptors(loader);
    if (!Object.values(properties).some(field => nativePromise(field.value)))
      return loader;
    const previous = loaders.get(loader);
    if (previous) return previous;
    const restored = Object.create(Object.getPrototypeOf(loader));
    loaders.set(loader, restored);
    for (const [key, field] of Object.entries(properties)) {
      Object.defineProperty(restored, key, {
        ...field,
        value: nativePromise(field.value)
          ? decodePromise(field.value)
          : field.value,
      });
    }
    if (!Object.isExtensible(loader)) Object.preventExtensions(restored);
    return restored;
  };
  const restoredMatches: Record<string, unknown>[] = [];
  for (let index = 0; index < matches.length; index++) {
    const match: unknown = matchFields[String(index)]?.value;
    if (!record(match)) throw invalid('a native match must be a record');
    const properties = descriptors(match, MATCH_FIELDS);
    const restored: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(properties)) {
      restored[key] =
        key === 'e'
          ? decodeError(field.value)
          : key === 'l'
            ? decodeLoader(field.value)
            : field.value;
    }
    restoredMatches.push(restored);
  }
  const restored: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(fields))
    restored[key] = key === 'matches' ? restoredMatches : field.value;
  return restored;
}

// The native generic represents arbitrary dynamic match values as `any` too;
// the actual supported data contract is checked before this adapter returns.
export const octaneRouterSnapshotAdapter: AnySerializationAdapter =
  createSerializationAdapter<any, any>({
    key: ADAPTER_KEY,
    test: (_value): _value is any => false,
    toSerializable() {
      throw invalid('the client decoder cannot serialize a server snapshot');
    },
    fromSerializable: decodeNativeSnapshot,
  });
