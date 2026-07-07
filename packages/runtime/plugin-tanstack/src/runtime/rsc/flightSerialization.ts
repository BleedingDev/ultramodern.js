// @effect-diagnostics asyncFunction:off globalFetch:off processEnv:off strictBooleanExpressions:off
import {
  isSerializedTanstackRscFlightValue,
  type SerializedTanstackRscFlightValue,
  TANSTACK_RSC_FLIGHT_VALUE,
} from './shared';
import {
  isRenderableServerComponent,
  isServerComponent,
  RSC_SLOT_USAGES_STREAM,
  SERVER_COMPONENT_STREAM,
} from './symbols';

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function serializeTanstackRscFlightValues(
  value: unknown,
  seen = new WeakMap<object, unknown>(),
): unknown {
  if (isServerComponent(value)) {
    const streamWrapper = value[SERVER_COMPONENT_STREAM];
    if (!streamWrapper) {
      throw new Error('Cannot serialize TanStack RSC without a Flight stream.');
    }

    const kind = isRenderableServerComponent(value)
      ? 'renderable'
      : 'composite';
    const slotUsagesStream =
      process.env.NODE_ENV === 'development' && kind === 'composite'
        ? value[RSC_SLOT_USAGES_STREAM]
        : undefined;

    return {
      [TANSTACK_RSC_FLIGHT_VALUE]: true,
      kind,
      stream: streamWrapper.createReplayStream(),
      ...(slotUsagesStream ? { slotUsagesStream } : {}),
    } satisfies SerializedTanstackRscFlightValue;
  }

  if (!value || typeof value !== 'object') {
    return value;
  }
  if (seen.has(value)) {
    return seen.get(value);
  }
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    seen.set(value, result);
    for (const item of value) {
      result.push(serializeTanstackRscFlightValues(item, seen));
    }
    return result;
  }
  if (!isPlainObject(value)) {
    return value;
  }

  const result: Record<string, unknown> = {};
  seen.set(value, result);
  for (const [key, item] of Object.entries(value)) {
    result[key] = serializeTanstackRscFlightValues(item, seen);
  }
  return result;
}

export async function reviveTanstackRscFlightValues(
  value: unknown,
  seen = new WeakMap<object, unknown>(),
): Promise<unknown> {
  let reviver:
    | ((serialized: SerializedTanstackRscFlightValue) => unknown)
    | undefined;

  const getReviver = async () => {
    if (!reviver) {
      const client = await import('./client');
      reviver = client.createTanstackRscValueFromFlight;
    }
    return reviver;
  };

  const visit = async (current: unknown): Promise<unknown> => {
    if (isSerializedTanstackRscFlightValue(current)) {
      return (await getReviver())(current);
    }
    if (!current || typeof current !== 'object') {
      return current;
    }
    if (seen.has(current)) {
      return seen.get(current);
    }
    if (Array.isArray(current)) {
      const result: unknown[] = [];
      seen.set(current, result);
      for (const item of current) {
        result.push(await visit(item));
      }
      return result;
    }
    if (!isPlainObject(current)) {
      return current;
    }

    const result: Record<string, unknown> = {};
    seen.set(current, result);
    for (const [key, item] of Object.entries(current)) {
      result[key] = await visit(item);
    }
    return result;
  };

  return visit(value);
}
