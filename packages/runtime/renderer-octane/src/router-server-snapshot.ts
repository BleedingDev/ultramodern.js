import {
  createRequestDataPolicy,
  publicDataError,
} from '@modern-js/renderer-core/data';
import type { RequestSession } from '@modern-js/renderer-core/session';
import {
  type AnyRouter,
  createSerializationAdapter,
} from '@octanejs/tanstack-router';
import { cleanupOctaneRouterSSR } from './router-server-cleanup';
import {
  ADAPTER_KEY,
  clearStack,
  descriptors,
  invalid,
  MATCH_FIELDS,
  NATIVE_ERROR_KIND,
  NATIVE_ROOT_FIELDS,
  nativePromise,
  octaneRouterSnapshotAdapter,
  ROUTE_ERROR_KIND,
  record,
  stringField,
} from './router-snapshot';
import { RouteDataError } from './routes';

const ERROR_FIELDS = new Set(['name', 'message', 'stack', 'cause']);
const ROUTE_ERROR_FIELDS = new Set([
  ...ERROR_FIELDS,
  'routeId',
  'status',
  'data',
]);
const errorConstructors = new Map<object, typeof Error>([
  [Error.prototype, Error],
  [TypeError.prototype, TypeError],
  [RangeError.prototype, RangeError],
  [SyntaxError.prototype, SyntaxError],
  [ReferenceError.prototype, ReferenceError],
  [URIError.prototype, URIError],
  [EvalError.prototype, EvalError],
]);

export interface OctaneRouterSerializationOptions {
  readonly production?: boolean;
  /** Request-private records that are structurally ordinary JavaScript objects. */
  readonly forbiddenValues?: readonly object[];
}

export interface OctaneRouterSerializationGuard {
  /** Call immediately before native dehydrateMatch reads the internal matches. */
  assertMatches(): void;
  /** Native Seroval swallows errors; call after dehydrate and before responding. */
  assertActive(): void;
}

const owners = new WeakMap<AnyRouter, RequestSession>();

/** Project the fresh native outer record before Seroval walks any application value. */
export function prepareOctaneRouterSerialization(
  router: AnyRouter,
  session: RequestSession,
  options: OctaneRouterSerializationOptions = {},
): OctaneRouterSerializationGuard {
  session.signal.throwIfAborted();
  if (owners.has(router)) {
    throw invalid('a router already has a request serialization owner');
  }
  const adapterProperty = Object.getOwnPropertyDescriptor(
    router.options,
    'serializationAdapters',
  );
  const dehydrateProperty = Object.getOwnPropertyDescriptor(
    router.options,
    'dehydrate',
  );
  if (
    adapterProperty?.get ||
    adapterProperty?.set ||
    dehydrateProperty?.get ||
    dehydrateProperty?.set
  ) {
    throw invalid('native serializer options must be owned data properties');
  }
  const consumerAdapters: unknown = adapterProperty?.value ?? [];
  if (
    !Array.isArray(consumerAdapters) ||
    Object.getPrototypeOf(consumerAdapters) !== Array.prototype
  ) {
    throw invalid('native serializationAdapters must be an owned array');
  }
  const adapterFields = descriptors(consumerAdapters);
  if (
    consumerAdapters.length > 1 ||
    (consumerAdapters.length === 1 &&
      adapterFields['0']?.value !== octaneRouterSnapshotAdapter) ||
    Object.keys(adapterFields).length !== consumerAdapters.length + 1
  ) {
    throw invalid(
      'custom serializationAdapters are not admitted in framework SSR; return supported public data',
    );
  }
  const consumerDehydrate: unknown = dehydrateProperty?.value;
  if (
    consumerDehydrate !== undefined &&
    typeof consumerDehydrate !== 'function'
  ) {
    throw invalid('native dehydrate must be an owned function');
  }
  owners.set(router, session);
  const production =
    options.production ?? process.env['NODE_ENV'] === 'production';
  const policy = createRequestDataPolicy([
    session,
    session.request,
    session.platform,
    session.platform.bindings,
    ...(options.forbiddenValues ?? []),
  ]);
  const copies = new WeakMap<object, object>();
  const projectedRoots = new WeakSet<object>();
  let nativeRoot: object | undefined;
  let released = false;
  let failure: unknown;

  const fail = (error: unknown): never => {
    failure ??= error;
    session.fail(failure);
    // Native cleanup stops bytes, while checked transport promises prevent
    // Seroval from traversing the invalid source value after cleanup.
    cleanupOctaneRouterSSR(router);
    throw failure;
  };
  const assertActive = () => {
    if (failure !== undefined) throw failure;
    session.signal.throwIfAborted();
  };

  function copyPublic(value: unknown): unknown {
    // Repeat validation at each deferred settlement, even when an earlier
    // snapshot already owns an alias of this source object.
    policy.assertValue(value);
    return copyValue(value);
  }

  function copyValue(value: unknown): unknown {
    if (value === null || typeof value !== 'object') return value;
    const fields = descriptors(value);
    const previous = copies.get(value);
    if (previous) return previous;
    const prototype = Object.getPrototypeOf(value);
    let result: object;
    if (prototype === Date.prototype) {
      result = new Date(Date.prototype.valueOf.call(value));
    } else if (prototype === RegExp.prototype) {
      const source = Object.getOwnPropertyDescriptor(
        RegExp.prototype,
        'source',
      )!.get!.call(value);
      const flags = [
        'hasIndices',
        'global',
        'ignoreCase',
        'multiline',
        'dotAll',
        'unicode',
        'unicodeSets',
        'sticky',
      ];
      const letters = ['d', 'g', 'i', 'm', 's', 'u', 'v', 'y'];
      const enabled = flags
        .map((flag, index) =>
          Object.getOwnPropertyDescriptor(RegExp.prototype, flag)?.get?.call(
            value,
          )
            ? letters[index]
            : '',
        )
        .join('');
      result = new RegExp(source, enabled);
    } else if (prototype === Map.prototype) result = new Map();
    else if (prototype === Set.prototype) result = new Set();
    else if (Array.isArray(value)) result = [];
    else result = Object.create(prototype);
    copies.set(value, result);
    if (prototype === Map.prototype) {
      for (const [key, item] of Map.prototype.entries.call(value)) {
        Map.prototype.set.call(result, copyValue(key), copyValue(item));
      }
    } else if (prototype === Set.prototype) {
      for (const item of Set.prototype.values.call(value)) {
        Set.prototype.add.call(result, copyValue(item));
      }
    }
    // Define array length last so frozen arrays retain their descriptor shape.
    for (const [key, field] of Object.entries(fields)) {
      if (Array.isArray(value) && key === 'length') continue;
      Object.defineProperty(result, key, {
        ...field,
        value: copyValue(field.value),
      });
    }
    if (Array.isArray(value))
      Object.defineProperty(result, 'length', fields['length']!);
    if (!Object.isExtensible(value)) Object.preventExtensions(result);
    return result;
  }

  function copyError(value: unknown): unknown {
    if (value === null || typeof value !== 'object') return copyPublic(value);
    policy.assertRoot(value);
    const prototype = Object.getPrototypeOf(value);
    const routeError = prototype === RouteDataError.prototype;
    const Constructor = errorConstructors.get(prototype);
    if (!routeError && !Constructor) return copyPublic(value);
    const fields = descriptors(
      value,
      routeError ? ROUTE_ERROR_FIELDS : ERROR_FIELDS,
      true,
    );
    if (Object.prototype.toString.call(value) !== '[object Error]') {
      throw invalid('an error requires genuine native Error slots');
    }
    const name = fields['name']
      ? stringField(fields, 'name')
      : routeError
        ? 'Error'
        : Constructor!.name;
    const message = fields['message'] ? stringField(fields, 'message') : '';
    const stack = production ? undefined : fields['stack']?.value;
    if (stack !== undefined && typeof stack !== 'string')
      throw invalid('stack must be a data string');
    const cause = fields['cause']
      ? copyPublic(fields['cause'].value)
      : undefined;
    const projectedData = routeError
      ? copyPublic(fields['data']?.value)
      : undefined;
    const previous = copies.get(value);
    if (previous) return previous;
    if (routeError) {
      const routeId = stringField(fields, 'routeId');
      const status: unknown = fields['status']?.value;
      if (
        !routeId ||
        !Number.isInteger(status) ||
        (status as number) < 400 ||
        (status as number) > 599
      ) {
        throw invalid('a route error has invalid identity or status');
      }
      const result = {
        kind: ROUTE_ERROR_KIND,
        routeId,
        status,
        name,
        message,
        data: projectedData,
        ...(stack === undefined ? {} : { stack }),
        ...(fields['cause'] ? { cause } : {}),
      };
      copies.set(value, result);
      return result;
    }
    const publicError = production
      ? publicDataError(value, true)
      : { name, message };
    const result = {
      kind: NATIVE_ERROR_KIND,
      type: production ? 'Error' : Constructor!.name,
      name: publicError.name,
      message: publicError.message,
      ...(stack === undefined ? {} : { stack }),
      ...(!production && fields['cause'] ? { cause } : {}),
    };
    copies.set(value, result);
    return result;
  }

  function copyPromise(value: Promise<unknown>): Promise<unknown> {
    policy.assertRoot(value);
    if (Reflect.ownKeys(value).length > 0) {
      // Promise.prototype.then performs SpeciesConstructor. An own constructor
      // (even a data descriptor) can execute a nested @@species getter.
      throw invalid(
        'deferred values require native Promises without own fields',
      );
    }
    const previous = copies.get(value);
    if (previous) return previous as Promise<unknown>;
    const checked = Promise.prototype.then.call(
      value,
      (settled: unknown) => {
        try {
          if (released || session.signal.aborted)
            throw invalid('the request serialization owner was released');
          policy.assertRoot(value);
          return copyPublic(settled);
        } catch (error) {
          return fail(error);
        }
      },
      (reason: unknown) => {
        if (released || session.signal.aborted)
          throw invalid('the request serialization owner was released');
        let projected: unknown;
        try {
          policy.assertRoot(value);
          projected = copyError(reason);
        } catch (error) {
          return fail(error);
        }
        throw projected;
      },
    ) as Promise<unknown>;
    copies.set(value, checked);
    // An already settled source can reject before native Seroval subscribes.
    void Promise.prototype.then.call(checked, undefined, () => {});
    return checked;
  }

  function copyLoader(value: unknown): unknown {
    if (nativePromise(value)) return copyPromise(value);
    if (!record(value)) return copyPublic(value);
    policy.assertRoot(value);
    const fields = descriptors(value);
    if (!Object.values(fields).some(field => nativePromise(field.value)))
      return copyPublic(value);
    const previous = copies.get(value);
    if (previous) return previous;
    const result = Object.create(Object.getPrototypeOf(value));
    copies.set(value, result);
    for (const [key, field] of Object.entries(fields)) {
      Object.defineProperty(result, key, {
        ...field,
        value: nativePromise(field.value)
          ? copyPromise(field.value)
          : copyPublic(field.value),
      });
    }
    if (!Object.isExtensible(value)) Object.preventExtensions(result);
    return result;
  }

  function projectRoot(value: unknown): object {
    assertActive();
    assertMatches();
    if (!record(value) || Object.getPrototypeOf(value) !== Object.prototype) {
      throw invalid(
        'the first native serializer value must be its fresh outer record',
      );
    }
    const fields = descriptors(value, NATIVE_ROOT_FIELDS);
    const matches: unknown = fields['matches']?.value;
    if (!fields['manifest'] || !Array.isArray(matches))
      throw invalid('the native outer record shape changed');
    const arrayFields = descriptors(matches);
    const projectedMatches: Record<string, unknown>[] = [];
    for (let index = 0; index < matches.length; index++) {
      const match: unknown = arrayFields[String(index)]?.value;
      if (!record(match)) throw invalid('native matches must be dense records');
      const matchFields = descriptors(match, MATCH_FIELDS);
      const projected: Record<string, unknown> = {};
      const id = stringField(matchFields, 'i');
      const status = stringField(matchFields, 's');
      const updatedAt: unknown = matchFields['u']?.value;
      if (!id || typeof updatedAt !== 'number' || !Number.isFinite(updatedAt))
        throw invalid('native match metadata changed');
      if (
        !['pending', 'success', 'error', 'notFound', 'redirected'].includes(
          status,
        )
      )
        throw invalid('native match status changed');
      projected['i'] = id;
      projected['u'] = updatedAt;
      projected['s'] = status;
      for (const [key, field] of Object.entries(matchFields)) {
        if (key === 'i' || key === 'u' || key === 's') continue;
        projected[key] =
          key === 'l'
            ? copyLoader(field.value)
            : key === 'e'
              ? copyError(field.value)
              : copyPublic(field.value);
      }
      projectedMatches.push(projected);
    }
    const result: Record<string, unknown> = {
      manifest: copyPublic(fields['manifest'].value),
      matches: projectedMatches,
    };
    if (fields['lastMatchId'])
      result['lastMatchId'] = stringField(fields, 'lastMatchId');
    if (fields['dehydratedData'])
      result['dehydratedData'] = copyPublic(fields['dehydratedData'].value);
    projectedRoots.add(result);
    return result;
  }

  const adapter = Object.freeze(
    createSerializationAdapter<any, any>({
      key: ADAPTER_KEY,
      test(value): value is any {
        if (
          value === null ||
          typeof value !== 'object' ||
          projectedRoots.has(value)
        )
          return false;
        if (nativeRoot) return false;
        nativeRoot = value;
        return true;
      },
      toSerializable(value) {
        try {
          return projectRoot(value);
        } catch (error) {
          return fail(error);
        }
      },
      fromSerializable: octaneRouterSnapshotAdapter.fromSerializable,
    }),
  );
  const adapters = Object.freeze([adapter]);
  const wrappedDehydrate = async () => {
    try {
      assertMatches();
      const result =
        typeof consumerDehydrate === 'function'
          ? await Reflect.apply(consumerDehydrate, router.options, [])
          : undefined;
      assertMatches();
      return result;
    } catch (error) {
      return fail(error);
    }
  };
  const nativeOptions = {
    ...router.options,
    serializationAdapters: adapters,
    dehydrate: wrappedDehydrate,
  };
  router.update(nativeOptions);
  session.registerCleanup(() => {
    released = true;
    cleanupOctaneRouterSSR(router);
  });
  function assertMatches() {
    try {
      assertActive();
      const currentAdapters = Object.getOwnPropertyDescriptor(
        router.options,
        'serializationAdapters',
      );
      const currentDehydrate = Object.getOwnPropertyDescriptor(
        router.options,
        'dehydrate',
      );
      if (
        currentAdapters?.get ||
        currentAdapters?.set ||
        currentAdapters?.value !== adapters ||
        currentDehydrate?.get ||
        currentDehydrate?.set ||
        currentDehydrate?.value !== wrappedDehydrate
      ) {
        throw invalid('the request serializer owner was replaced');
      }
      for (const match of router.stores.matches.get()) {
        const prototype = Object.getPrototypeOf(match);
        if (prototype !== Object.prototype && prototype !== null) {
          throw invalid('native matches require owned plain records');
        }
        for (const key of [
          'id',
          'routeId',
          'updatedAt',
          'status',
          '__beforeLoadContext',
          'loaderData',
          'error',
          'ssr',
          'globalNotFound',
          'styles',
          'headScripts',
        ]) {
          const field = Object.getOwnPropertyDescriptor(match, key);
          if (field?.get || field?.set)
            throw invalid(
              'native match fields must be owned values before dehydrate',
            );
          if (
            !field &&
            prototype &&
            Object.getOwnPropertyDescriptor(prototype, key)
          ) {
            throw invalid('native match fields cannot be inherited');
          }
          if (
            (key === 'id' || key === 'routeId') &&
            (typeof field?.value !== 'string' || !field.value)
          ) {
            throw invalid(
              'native match identity must be an owned nonempty string',
            );
          }
          if (
            key === 'updatedAt' &&
            (typeof field?.value !== 'number' || !Number.isFinite(field.value))
          ) {
            throw invalid('native updatedAt must be an owned finite number');
          }
          if (
            key === 'status' &&
            (typeof field?.value !== 'string' ||
              ![
                'pending',
                'success',
                'error',
                'notFound',
                'redirected',
              ].includes(field.value))
          ) {
            throw invalid('native status must be an owned supported string');
          }
          if (
            (key === 'styles' || key === 'headScripts') &&
            field?.value !== undefined
          ) {
            const value: unknown = field.value;
            if (
              !Array.isArray(value) ||
              Object.getPrototypeOf(value) !== Array.prototype
            ) {
              throw invalid(
                'native styles/headScripts are not admitted by the fragment host',
              );
            }
            const fields = descriptors(value);
            if (
              fields['length']?.value !== 0 ||
              Reflect.ownKeys(value).length !== 1
            ) {
              throw invalid(
                'native styles/headScripts are not admitted by the fragment host',
              );
            }
          }
        }
      }
    } catch (error) {
      fail(error);
    }
  }
  return { assertActive, assertMatches };
}
