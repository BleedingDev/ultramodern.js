import type {
  DataOutcome,
  PublicDataOutcome,
} from '@modern-js/renderer-core/data';
import {
  assertPublicData,
  DataProtocolError,
} from '@modern-js/renderer-core/data';

/** A route boundary receives only the public error projection and its status. */
export class RouteDataError extends Error {
  readonly status: number;
  readonly data: unknown;
  readonly routeId: string;

  constructor(
    routeId: string,
    outcome: Extract<DataOutcome | PublicDataOutcome, { kind: 'error' }>,
  ) {
    super(outcome.error.message);
    this.name = outcome.error.name;
    this.routeId = routeId;
    this.status =
      'response' in outcome ? outcome.response.status : outcome.status;
    this.data = outcome.data;
  }
}

export interface RouteDataErrorSnapshot {
  kind: 'ultramodern-route-data-error';
  version: 1;
  routeId: string;
  status: number;
  data: unknown;
  error: { name: string; message: string; stack?: string };
}

function invalid(message: string): never {
  throw new DataProtocolError(message);
}

function publicFields(
  value: object,
  required: readonly string[],
  optional: readonly string[] = [],
  allowStackAccessor = false,
): Record<string, PropertyDescriptor> {
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (
      typeof key !== 'string' ||
      (!required.includes(key) && !optional.includes(key))
    ) {
      invalid('Route data errors must not contain undeclared fields');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (descriptor.get || descriptor.set) {
      // Native Node errors can own a lazy stack getter. Never evaluate it.
      if (allowStackAccessor && key === 'stack') continue;
      invalid('Route data errors must not contain accessors');
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(descriptors, key)) {
      invalid('Route data errors are missing a declared field');
    }
  }
  return descriptors;
}

function validateFields(
  routeId: unknown,
  status: unknown,
  name: unknown,
  message: unknown,
): { routeId: string; status: number; name: string; message: string } {
  if (typeof routeId !== 'string' || routeId.length === 0) {
    invalid('Route data errors require a nonempty route identifier');
  }
  if (
    typeof status !== 'number' ||
    !Number.isInteger(status) ||
    status < 200 ||
    status > 599
  ) {
    invalid('Route data errors require a valid public HTTP status');
  }
  if (typeof name !== 'string' || typeof message !== 'string') {
    invalid('Route data errors require public name and message strings');
  }
  return { routeId, status, name, message };
}

/** Preserve the known public route error without serializing its Error object. */
export function projectRouteDataError(
  error: unknown,
  production = true,
): RouteDataErrorSnapshot {
  if (
    !error ||
    typeof error !== 'object' ||
    Object.getPrototypeOf(error) !== RouteDataError.prototype
  ) {
    invalid('Only the exact RouteDataError class has a route error projection');
  }
  const descriptors = publicFields(
    error,
    ['routeId', 'status', 'data', 'name', 'message'],
    ['stack'],
    true,
  );
  const routeId: unknown = descriptors.routeId!.value;
  const status: unknown = descriptors.status!.value;
  const name: unknown = descriptors.name!.value;
  const message: unknown = descriptors.message!.value;
  const fields = validateFields(routeId, status, name, message);
  const snapshot: RouteDataErrorSnapshot = {
    kind: 'ultramodern-route-data-error',
    version: 1,
    routeId: fields.routeId,
    status: fields.status,
    data: descriptors.data!.value,
    error: {
      name: fields.name,
      message: fields.message,
    },
  };
  const stack = descriptors.stack;
  if (stack && !stack.get && !stack.set) {
    if (typeof stack.value !== 'string') {
      invalid('Route data error stacks must be strings');
    }
    if (!production) snapshot.error.stack = stack.value;
  }
  assertPublicData(snapshot);
  return snapshot;
}

function plainRecord(value: unknown): object {
  if (!value || typeof value !== 'object') {
    invalid('Malformed route data error snapshot');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    invalid('Route data error snapshots require plain records');
  }
  return value;
}

/** Reconstruct only the validated route error tag produced by this adapter. */
export function restoreRouteDataError(snapshot: unknown): RouteDataError {
  const descriptors = publicFields(plainRecord(snapshot), [
    'kind',
    'version',
    'routeId',
    'status',
    'data',
    'error',
  ]);
  if (
    descriptors.kind!.value !== 'ultramodern-route-data-error' ||
    descriptors.version!.value !== 1
  ) {
    invalid('Unsupported route data error snapshot');
  }
  const error = publicFields(
    plainRecord(descriptors.error!.value),
    ['name', 'message'],
    ['stack'],
  );
  const routeId: unknown = descriptors.routeId!.value;
  const fields = validateFields(
    routeId,
    descriptors.status!.value,
    error.name!.value,
    error.message!.value,
  );
  if (error.stack && typeof error.stack.value !== 'string') {
    invalid('Route data error stacks must be strings');
  }
  assertPublicData(snapshot);
  const restored = new RouteDataError(fields.routeId, {
    kind: 'error',
    status: fields.status,
    data: descriptors.data!.value,
    error: { name: fields.name, message: fields.message },
    thrown: true,
  });
  if (error.stack) {
    Object.defineProperty(restored, 'stack', {
      value: error.stack.value,
      configurable: true,
      writable: true,
    });
  }
  return restored;
}
