import {
  assertPublicData,
  DataProtocolError,
  parsePublicData,
  serializePublicData,
} from '@modern-js/renderer-core/data';
import type { RequestSession } from '@modern-js/renderer-core/session';
import { getRequestEvent } from '@solidjs/web';
import type { RouteDataErrorSnapshot } from '../route-data-error';
import { projectRouteDataError, RouteDataError } from '../route-data-error';

export type PublicSnapshotOwner = Pick<RequestSession, 'fail' | 'signal'>;
interface DeferredObservation {
  scopes: Array<WeakSet<object>>;
  projection: Promise<unknown>;
}
const observed = new WeakMap<
  PublicSnapshotOwner,
  WeakMap<Promise<unknown>, DeferredObservation>
>();
const snapshots = new WeakMap<
  PublicSnapshotOwner,
  WeakMap<object, { snapshot: unknown; deferred: Promise<unknown>[] }>
>();
const projectedPromises = new WeakSet<Promise<unknown>>();

function requestFailureOwner(
  explicit?: PublicSnapshotOwner,
): PublicSnapshotOwner | undefined {
  return explicit ?? getRequestEvent()?.locals.session;
}

/** Keep known private request identities out of an otherwise plain public graph. */
function privateReferences(
  owner: PublicSnapshotOwner | undefined,
  contexts: readonly unknown[],
): WeakSet<object> {
  const references = new WeakSet<object>();
  const event = getRequestEvent();
  const identity = owner && 'identity' in owner ? owner.identity : undefined;
  let count = 0;
  const visit = (value: unknown, depth: number): void => {
    if (
      !value ||
      (typeof value !== 'object' && typeof value !== 'function') ||
      value === identity
    )
      return;
    if (++count > 20_000 || depth > 100)
      throw new DataProtocolError(
        'Private request context exceeds its size or depth limit',
      );
    if (references.has(value)) return;
    references.add(value);
    const prototype = Object.getPrototypeOf(value);
    if (prototype === Map.prototype) {
      for (const [key, entry] of Map.prototype.entries.call(value)) {
        visit(key, depth + 1);
        visit(entry, depth + 1);
      }
    } else if (prototype === Set.prototype) {
      for (const entry of Set.prototype.values.call(value))
        visit(entry, depth + 1);
    } else if (
      prototype === Object.prototype ||
      prototype === null ||
      prototype === Array.prototype
    ) {
      for (const key of Reflect.ownKeys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (!descriptor.get && !descriptor.set)
          visit(descriptor.value, depth + 1);
      }
    }
  };
  if (owner) {
    references.add(owner);
    if ('request' in owner) visit(owner.request, 0);
    if ('platform' in owner) visit(owner.platform, 0);
  }
  if (event) {
    visit(event, 0);
    visit(event.locals, 0);
  }
  for (const context of contexts) visit(context, 0);
  return references;
}

function rejectPrivateReferences(
  value: unknown,
  references: WeakSet<object>,
): void {
  const seen = new WeakSet<object>();
  let count = 0;
  const visit = (current: unknown, depth: number): void => {
    if (++count > 20_000 || depth > 100)
      throw new DataProtocolError(
        'Public data exceeds its size or depth limit',
      );
    if (!current || typeof current !== 'object') return;
    if (references.has(current))
      throw new DataProtocolError(
        'Public data must not contain private request references',
      );
    if (seen.has(current)) return;
    seen.add(current);
    const prototype = Object.getPrototypeOf(current);
    if (prototype === Promise.prototype) return;
    for (const key of Reflect.ownKeys(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key)!;
      if (!descriptor.get && !descriptor.set)
        visit(descriptor.value, depth + 1);
    }
    if (prototype === Map.prototype) {
      for (const [key, entry] of Map.prototype.entries.call(current)) {
        visit(key, depth + 1);
        visit(entry, depth + 1);
      }
    } else if (prototype === Set.prototype) {
      for (const entry of Set.prototype.values.call(current))
        visit(entry, depth + 1);
    }
  };
  visit(value, 0);
}

function projectDeferred(
  promise: Promise<unknown>,
  session: PublicSnapshotOwner,
  references: WeakSet<object>,
): Promise<unknown> {
  let promises = observed.get(session);
  if (!promises) {
    promises = new WeakMap();
    observed.set(session, promises);
  }
  const previous = promises.get(promise);
  if (previous) {
    previous.scopes.push(references);
    return previous.projection;
  }
  const scopes = [references];
  const owner = new WeakRef(session);
  const project = (value: unknown): unknown => {
    try {
      for (const scope of scopes) rejectPrivateReferences(value, scope);
      return immutableSnapshot(value, owner.deref());
    } catch (error) {
      owner.deref()?.fail(error);
      throw Object.freeze({
        name: 'DataProtocolError',
        message: 'Invalid public deferred data',
      });
    }
  };
  const reject = (reason: unknown): never => {
    let projected: unknown;
    try {
      for (const scope of scopes) rejectPrivateReferences(reason, scope);
      projected =
        reason instanceof Error
          ? preparePublicMatchError(reason, owner.deref())
          : immutableSnapshot(reason, owner.deref());
    } catch (error) {
      owner.deref()?.fail(error);
      throw Object.freeze({
        name: 'DataProtocolError',
        message: 'Invalid public deferred error',
      });
    }
    throw projected;
  };
  const projection = Promise.prototype.then.call(
    promise,
    project,
    reject,
  ) as Promise<unknown>;
  const observation = { scopes, projection };
  promises.set(promise, observation);
  promises.set(projection, observation);
  projectedPromises.add(projection);
  // RC.13 annotates native Promise handles with s then v. Keep that protocol
  // while preventing metadata from becoming a second unchecked value channel.
  let status: 0 | 1 | 2 | undefined;
  let settledValue: unknown;
  Object.defineProperties(projection, {
    s: {
      get: () => status,
      set: (next: unknown) => {
        if (next === undefined || next === 0 || next === 1 || next === 2) {
          status = next;
          return;
        }
        const error = new DataProtocolError(
          'Unsupported native immutable route-data Promise state. AsyncIterable values are not supported.',
        );
        owner.deref()?.fail(error);
        throw error;
      },
    },
    v: {
      get: () => settledValue,
      set: (next: unknown) => {
        try {
          for (const scope of scopes) rejectPrivateReferences(next, scope);
          settledValue =
            status === 2 && next instanceof Error
              ? preparePublicMatchError(next, owner.deref())
              : immutableSnapshot(next, owner.deref());
        } catch (error) {
          owner.deref()?.fail(error);
          throw error;
        }
      },
    },
  });
  Object.seal(projection);
  // Native serialization may not have subscribed yet; rejection is still owned.
  void projection.catch(() => {});
  return projection;
}

/** Replace only supported top-level Promise slots before the canonical codec. */
function criticalProjection(
  value: unknown,
  validateNativePromise?: (promise: Promise<unknown>) => void,
): {
  critical: unknown;
  slots: Array<[string, PropertyDescriptor]>;
} {
  const seen = new WeakMap<object, object>();
  const slots: Array<[string, PropertyDescriptor]> = [];
  let count = 0;
  const copy = (current: unknown, depth: number): unknown => {
    if (++count > 20_000 || depth > 100)
      throw new DataProtocolError(
        'Public data exceeds its size or depth limit',
      );
    if (!current || typeof current !== 'object') return current;
    const previous = seen.get(current);
    if (previous) return previous;
    const prototype = Object.getPrototypeOf(current);
    for (const key of Reflect.ownKeys(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key)!;
      if (typeof key === 'symbol' || descriptor.get || descriptor.set)
        throw new DataProtocolError(
          'Public data must not contain symbols or accessors',
        );
    }
    let result: object;
    if (prototype === Object.prototype || prototype === null)
      result = Object.create(prototype);
    else if (prototype === Array.prototype && Array.isArray(current))
      result = [];
    else {
      rejectMutableNativeContainer(prototype);
      assertPublicData(current);
      throw new DataProtocolError('Unsupported public data container');
    }
    seen.set(current, result);
    for (const key of Reflect.ownKeys(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key)!;
      if (typeof key === 'symbol' || descriptor.get || descriptor.set)
        throw new DataProtocolError(
          'Public data must not contain symbols or accessors',
        );
      if (
        depth === 0 &&
        (prototype === Object.prototype || prototype === null) &&
        descriptor.enumerable &&
        descriptor.value instanceof Promise
      ) {
        const promise = descriptor.value as Promise<unknown>;
        if (Object.getPrototypeOf(promise) !== Promise.prototype)
          throw new DataProtocolError(
            'Public data must not contain custom Promise properties or prototypes',
          );
        if (
          !projectedPromises.has(promise) &&
          Reflect.ownKeys(promise).length !== 0
        ) {
          if (!validateNativePromise)
            throw new DataProtocolError(
              'Public data must not contain custom Promise properties or prototypes',
            );
          validateNativePromise(promise);
        }
        slots.push([key, descriptor]);
        Object.defineProperty(result, key, { ...descriptor, value: undefined });
      } else
        Object.defineProperty(result, key, {
          ...descriptor,
          value: copy(descriptor.value, depth + 1),
        });
    }
    return result;
  };
  return { critical: copy(value, 0), slots };
}

/** A stable transfer snapshot; the renderer retains its original values and Promises. */
export function preparePublicLoaderData(
  value: unknown,
  owner?: PublicSnapshotOwner,
  privateContexts: readonly unknown[] = [],
): unknown {
  return prepareLoaderData(value, owner, privateContexts);
}

/** Only the native keyed receiver admits Seroval's checked s/v data metadata. */
export function prepareHydratedLoaderData(
  value: unknown,
  owner?: PublicSnapshotOwner,
  privateContexts: readonly unknown[] = [],
): unknown {
  return prepareLoaderData(value, owner, privateContexts, true);
}

function prepareLoaderData(
  value: unknown,
  owner?: PublicSnapshotOwner,
  privateContexts: readonly unknown[] = [],
  hydration = false,
): unknown {
  const session = requestFailureOwner(owner);
  const references = privateReferences(session, privateContexts);
  rejectPrivateReferences(value, references);
  if (value && typeof value === 'object' && session) {
    const cached = snapshots.get(session)?.get(value);
    if (cached) {
      for (const promise of cached.deferred)
        projectDeferred(promise, session, references);
      return cached.snapshot;
    }
  }
  const nativeSettlements = new Map<
    Promise<unknown>,
    { status: 0 | 1 | 2; hasValue: boolean; value: unknown }
  >();
  const validateNativePromise = hydration
    ? (promise: Promise<unknown>): void => {
        const descriptors = Object.getOwnPropertyDescriptors(promise);
        for (const key of Reflect.ownKeys(promise)) {
          const descriptor = Object.getOwnPropertyDescriptor(promise, key)!;
          if ((key !== 's' && key !== 'v') || descriptor.get || descriptor.set)
            throw new DataProtocolError(
              'Native hydrated Promise metadata must contain only s/v data fields',
            );
        }
        const status = descriptors.s?.value;
        if (status !== 0 && status !== 1 && status !== 2)
          throw new DataProtocolError(
            'Unsupported native hydrated Promise state; AsyncIterable values are not supported',
          );
        if ((status === 1 || status === 2) && !descriptors.v)
          throw new DataProtocolError(
            'Native settled hydrated Promises require a value data field',
          );
        let projected: unknown;
        if (descriptors.v) {
          const settled = descriptors.v.value;
          rejectPrivateReferences(settled, references);
          if (status === 2 && settled instanceof Error)
            projected = preparePublicMatchError(
              settled,
              session,
              privateContexts,
            );
          else projected = immutableSnapshot(settled, session);
        }
        nativeSettlements.set(promise, {
          status,
          hasValue: Boolean(descriptors.v),
          value: projected,
        });
      }
    : undefined;
  const { critical, slots } = criticalProjection(value, validateNativePromise);
  let snapshot = parsePublicData(serializePublicData(critical));
  if (slots.length) {
    if (
      !session ||
      typeof session.fail !== 'function' ||
      !(session.signal instanceof AbortSignal)
    )
      throw new DataProtocolError(
        'Native deferred public data requires its owning request session',
      );
    for (const [key, descriptor] of slots) {
      const projection = projectDeferred(descriptor.value, session, references);
      const settlement = nativeSettlements.get(descriptor.value);
      if (settlement) {
        // Keep an already decoded native slot settled before the client memo
        // reads it. Only our controlled transport receives these annotations.
        Object.getOwnPropertyDescriptor(projection, 's')!.set!.call(
          projection,
          settlement.status,
        );
        if (settlement.hasValue)
          Object.getOwnPropertyDescriptor(projection, 'v')!.set!.call(
            projection,
            settlement.value,
          );
      }
      Object.defineProperty(snapshot, key, {
        ...descriptor,
        value: projection,
      });
    }
  }
  snapshot = rememberSnapshot(
    value,
    snapshot,
    session,
    slots.map(([, descriptor]) => descriptor.value),
  );
  return snapshot;
}

/** Native beforeLoad context is an explicit pure public return value. */
export function preparePublicContextData(
  value: unknown,
  owner?: PublicSnapshotOwner,
  privateContexts: readonly unknown[] = [],
): unknown {
  assertPublicData(value);
  return preparePublicLoaderData(value, owner, privateContexts);
}

/** Preserve the native composed root while replacing authored nested values. */
export function preparePublishedRouteContext(
  context: Record<string, unknown>,
  owner: PublicSnapshotOwner,
  privateContexts: readonly unknown[] = [],
): void {
  const snapshot = preparePublicContextData(context, owner, privateContexts);
  if (!snapshot || typeof snapshot !== 'object')
    throw new DataProtocolError(
      'Native public route context must be a plain record',
    );
  const prototype = Object.getPrototypeOf(context);
  if (prototype !== Object.prototype && prototype !== null)
    throw new DataProtocolError(
      'Native public route context must be a plain record',
    );
  if (snapshot !== context) {
    for (const key of Reflect.ownKeys(context)) {
      const descriptor = Object.getOwnPropertyDescriptor(context, key)!;
      const checked = Object.getOwnPropertyDescriptor(snapshot, key);
      if (checked && checked.value !== descriptor.value)
        Object.defineProperty(context, key, {
          ...descriptor,
          value: checked.value,
        });
    }
  }
  freezeSnapshot(context);
  const record = { snapshot: context, deferred: [] };
  snapshots.get(owner)?.set(context, record);
  snapshots.get(owner)?.set(snapshot, record);
}

const errorNames = new Map<object, string>([
  [DataProtocolError.prototype, 'DataProtocolError'],
  [Error.prototype, 'Error'],
  [EvalError.prototype, 'EvalError'],
  [RangeError.prototype, 'RangeError'],
  [ReferenceError.prototype, 'ReferenceError'],
  [SyntaxError.prototype, 'SyntaxError'],
  [TypeError.prototype, 'TypeError'],
  [URIError.prototype, 'URIError'],
]);
export interface PublicMatchError {
  name: string;
  message: string;
  stack?: string;
  cause?: unknown;
}

/** Error diagnostics are a fixed public projection, never a raw Error object. */
export function preparePublicMatchError(
  error: unknown,
  owner?: PublicSnapshotOwner,
  privateContexts: readonly unknown[] = [],
): PublicMatchError | RouteDataErrorSnapshot | Record<string, unknown> {
  const references = privateReferences(
    requestFailureOwner(owner),
    privateContexts,
  );
  if (
    error &&
    typeof error === 'object' &&
    Object.getPrototypeOf(error) === RouteDataError.prototype
  ) {
    const result = projectRouteDataError(
      error,
      process.env.NODE_ENV !== 'development',
    );
    rejectPrivateReferences(result, references);
    return immutableSnapshot(
      result,
      requestFailureOwner(owner),
    ) as RouteDataErrorSnapshot;
  }
  const fallback = Object.freeze({
    name: 'Error',
    message: 'Unexpected Server Error',
  });
  if (!error || typeof error !== 'object') return fallback;
  const prototype = Object.getPrototypeOf(error);
  if (
    (prototype === Object.prototype || prototype === null) &&
    Object.getOwnPropertyDescriptor(error, 'isNotFound')?.value === true
  ) {
    return preparePublicContextData(error, owner, privateContexts) as Record<
      string,
      unknown
    >;
  }
  const name = errorNames.get(prototype);
  if (!name)
    throw new DataProtocolError(
      'Public match errors require an exact supported error prototype',
    );
  const descriptors = Object.getOwnPropertyDescriptors(error);
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = Object.getOwnPropertyDescriptor(error, key)!;
    if (
      typeof key !== 'string' ||
      !['name', 'message', 'stack', 'cause'].includes(key)
    )
      throw new DataProtocolError(
        'Public errors must not contain undeclared fields',
      );
    // Node's native lazy stack is an accessor. Never read it.
    if (key === 'stack' && (descriptor.get || descriptor.set)) continue;
    if (typeof key === 'symbol' || descriptor.get || descriptor.set)
      throw new DataProtocolError(
        'Public errors must not contain symbols or accessors',
      );
    rejectPrivateReferences(descriptor.value, references);
    assertPublicData(descriptor.value);
  }
  if (
    process.env.NODE_ENV !== 'development' &&
    prototype !== DataProtocolError.prototype
  )
    return fallback;
  const result: PublicMatchError = {
    name:
      typeof descriptors.name?.value === 'string'
        ? descriptors.name.value
        : name,
    message:
      typeof descriptors.message?.value === 'string'
        ? descriptors.message.value
        : fallback.message,
  };
  if (
    process.env.NODE_ENV === 'development' &&
    typeof descriptors.stack?.value === 'string'
  )
    result.stack = descriptors.stack.value;
  if (descriptors.cause) result.cause = descriptors.cause.value;
  return immutableSnapshot(
    result,
    requestFailureOwner(owner),
  ) as PublicMatchError;
}

function rejectMutableNativeContainer(prototype: object | null): void {
  const names = new Map<object, string>([
    [Date.prototype, 'Date'],
    [RegExp.prototype, 'RegExp'],
    [Map.prototype, 'Map'],
    [Set.prototype, 'Set'],
  ]);
  const name = prototype && names.get(prototype);
  if (name)
    throw new DataProtocolError(
      `Unsupported native immutable route-data: ${name}. Use scalar values, plain records or arrays.`,
    );
}

/** Promise transport handles retain Solid's native state annotation protocol. */
function freezeSnapshot(value: unknown): void {
  const seen = new WeakSet<object>();
  const visit = (current: unknown): void => {
    if (
      !current ||
      typeof current !== 'object' ||
      current instanceof Promise ||
      seen.has(current)
    )
      return;
    seen.add(current);
    rejectMutableNativeContainer(Object.getPrototypeOf(current));
    for (const key of Reflect.ownKeys(current))
      visit(Object.getOwnPropertyDescriptor(current, key)!.value);
    Object.freeze(current);
  };
  visit(value);
}

function immutableSnapshot(
  value: unknown,
  owner?: PublicSnapshotOwner,
): unknown {
  assertPublicData(value);
  const { critical } = criticalProjection(value);
  const snapshot = parsePublicData(serializePublicData(critical));
  return rememberSnapshot(value, snapshot, owner);
}

/** Preserve aliases across loader/context projections in the same public scope. */
function rememberSnapshot(
  original: unknown,
  snapshot: unknown,
  owner?: PublicSnapshotOwner,
  deferred: Promise<unknown>[] = [],
): unknown {
  if (!owner || !original || typeof original !== 'object') {
    freezeSnapshot(snapshot);
    return snapshot;
  }
  let values = snapshots.get(owner);
  if (!values) {
    values = new WeakMap();
    snapshots.set(owner, values);
  }
  const aliases = new WeakMap<object, object>();
  const records: Array<[object, object]> = [];
  const reuse = (source: unknown, projected: unknown): unknown => {
    if (
      !source ||
      typeof source !== 'object' ||
      source instanceof Promise ||
      !projected ||
      typeof projected !== 'object'
    )
      return projected;
    const cached = values.get(source);
    if (cached) return cached.snapshot;
    const previous = aliases.get(source);
    if (previous) return previous;
    aliases.set(source, projected);
    records.push([source, projected]);
    for (const key of Reflect.ownKeys(projected)) {
      const sourceDescriptor = Object.getOwnPropertyDescriptor(source, key);
      const descriptor = Object.getOwnPropertyDescriptor(projected, key)!;
      if (!sourceDescriptor || sourceDescriptor.get || sourceDescriptor.set)
        continue;
      const value = reuse(sourceDescriptor.value, descriptor.value);
      if (value !== descriptor.value)
        Object.defineProperty(projected, key, { ...descriptor, value });
    }
    return projected;
  };
  const result = reuse(original, snapshot);
  // Reused aliases may retain an earlier, larger public value than its source.
  const { critical } = criticalProjection(result);
  serializePublicData(critical);
  freezeSnapshot(result);
  for (const [source, projected] of records) {
    const record = {
      snapshot: projected,
      deferred: source === original ? deferred : [],
    };
    values.set(source, record);
    values.set(projected, record);
  }
  return result;
}
