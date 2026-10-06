import { fromJSON, toJSON } from 'seroval';
import { validateSerializedData } from './tree';

export const DATA_CODEC = 'seroval-json@1.6.8' as const;
export const MAX_DATA_BYTES = 1024 * 1024;
const MAX_DEPTH = 100;
const MAX_NODES = 20_000;

export class DataProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataProtocolError';
  }
}

/** Only explicit loader/action results are public. Request context is not data. */
export function assertPublicData(
  value: unknown,
  options: { privateReferences?: WeakSet<object> } = {},
): void {
  const seen = new WeakSet<object>();
  let count = 0;
  const visit = (current: unknown, depth: number): void => {
    if (++count > MAX_NODES || depth > MAX_DEPTH) {
      throw new DataProtocolError(
        'Public data exceeds its size or depth limit',
      );
    }
    if (current === null || current === undefined) return;
    const type = typeof current;
    if (
      (type === 'object' || type === 'function') &&
      options.privateReferences?.has(current as object)
    ) {
      throw new DataProtocolError(
        'Request-private context cannot be transferred as public data',
      );
    }
    if (
      type === 'string' ||
      type === 'boolean' ||
      type === 'number' ||
      type === 'bigint'
    )
      return;
    if (type !== 'object') {
      throw new DataProtocolError(`Unsupported public data type: ${type}`);
    }
    const object = current as object;
    if (seen.has(object)) return;
    seen.add(object);
    const prototype = Object.getPrototypeOf(object);
    if (
      prototype !== Object.prototype &&
      prototype !== null &&
      prototype !== Array.prototype &&
      prototype !== Date.prototype &&
      prototype !== RegExp.prototype &&
      prototype !== Map.prototype &&
      prototype !== Set.prototype
    ) {
      throw new DataProtocolError(
        'Public data must not contain native views, request context or class instances',
      );
    }
    const ownKeys = Reflect.ownKeys(object);
    const descriptors: PropertyDescriptor[] = [];
    for (const key of ownKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(object, key)!;
      if (typeof key === 'symbol' || descriptor.get || descriptor.set) {
        throw new DataProtocolError(
          'Public data must not contain symbols or accessors',
        );
      }
      descriptors.push(descriptor);
    }
    if (
      prototype === Array.prototype &&
      ownKeys.some(
        key =>
          key !== 'length' &&
          (typeof key !== 'string' ||
            !/^(?:0|[1-9]\d*)$/.test(key) ||
            Number(key) >= 0xffff_ffff),
      )
    ) {
      throw new DataProtocolError(
        'Public data arrays must contain only length and canonical index properties',
      );
    }
    // Native serializers may read nonenumerable method overrides too. Validate
    // every own value before using a container, without calling its properties.
    for (const descriptor of descriptors) visit(descriptor.value, depth + 1);
    try {
      if (prototype === Array.prototype && !Array.isArray(object)) {
        throw new TypeError('Missing native array slots');
      }
      if (prototype === Date.prototype) Date.prototype.valueOf.call(object);
      if (prototype === RegExp.prototype) {
        Object.getOwnPropertyDescriptor(RegExp.prototype, 'source')!.get!.call(
          object,
        );
      }
      if (prototype === Map.prototype)
        Map.prototype.has.call(object, undefined);
      if (prototype === Set.prototype)
        Set.prototype.has.call(object, undefined);
    } catch {
      throw new DataProtocolError(
        'Public data requires valid native container values',
      );
    }
    if (
      ((prototype === Date.prototype ||
        prototype === Map.prototype ||
        prototype === Set.prototype) &&
        ownKeys.length > 0) ||
      (prototype === RegExp.prototype &&
        ownKeys.some(key => key !== 'lastIndex'))
    ) {
      throw new DataProtocolError(
        'Public data native containers must not override their built-in properties',
      );
    }
    if (prototype === Map.prototype) {
      for (const [key, entry] of Map.prototype.entries.call(object)) {
        visit(key, depth + 1);
        visit(entry, depth + 1);
      }
    } else if (prototype === Set.prototype) {
      for (const entry of Set.prototype.values.call(object)) {
        visit(entry, depth + 1);
      }
    }
  };
  visit(value, 0);
}

/** JSON text stays inert when it is placed in a script element. */
export function escapeInlineDataJSON(text: string): string {
  return text.replace(/[<>&\u2028\u2029]/gu, character => {
    switch (character) {
      case '<':
        return '\\u003C';
      case '>':
        return '\\u003E';
      case '&':
        return '\\u0026';
      case '\u2028':
        return '\\u2028';
      default:
        return '\\u2029';
    }
  });
}

/** JSON text. `serializeInlineData` escapes it when it goes into a document. */
export function serializePublicData(value: unknown): string {
  assertPublicData(value);
  const text = JSON.stringify({
    codec: DATA_CODEC,
    data: toJSON(value, { depthLimit: MAX_DEPTH }),
  });
  // A document carries the escaped form, and the decoder bounds that size.
  if (
    new TextEncoder().encode(escapeInlineDataJSON(text)).byteLength >
    MAX_DATA_BYTES
  ) {
    throw new DataProtocolError('Public data exceeds its byte limit');
  }
  // Apply the exact decoder limits to our wire representation before emitting it.
  try {
    validateSerializedData(JSON.parse(text).data);
  } catch {
    throw new DataProtocolError(
      'Public data exceeds the supported codec limits',
    );
  }
  return text;
}

export function parsePublicData(text: string): unknown {
  // A document carries the escaped form, and the decoder bounds that size.
  if (
    new TextEncoder().encode(escapeInlineDataJSON(text)).byteLength >
    MAX_DATA_BYTES
  ) {
    throw new DataProtocolError('Public data exceeds its byte limit');
  }
  try {
    const envelope: unknown = JSON.parse(text);
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
      throw new DataProtocolError('Malformed public data envelope');
    }
    const record = envelope as Record<string, unknown>;
    if (
      Object.keys(record).length !== 2 ||
      record['codec'] !== DATA_CODEC ||
      !Object.hasOwn(record, 'data')
    ) {
      throw new DataProtocolError('Unsupported public data codec');
    }
    validateSerializedData(record['data']);
    const result: unknown = fromJSON(record['data']);
    assertPublicData(result);
    return result;
  } catch (error) {
    if (error instanceof DataProtocolError) throw error;
    throw new DataProtocolError('Malformed public data payload');
  }
}
