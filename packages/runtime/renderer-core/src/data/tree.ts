import type { SerovalJSON } from 'seroval';

const MAX_NODES = 20_000;
const MAX_DEPTH = 300;
type NodeRecord = Record<string, unknown>;

function record(value: unknown): NodeRecord {
  if (
    value === null ||
    typeof value !== 'object' ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new TypeError('Malformed public data tree record');
  }
  return value as NodeRecord;
}

function exactFields(value: NodeRecord, fields: string[]): void {
  if (
    Reflect.ownKeys(value).length !== fields.length ||
    fields.some(field => {
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      return descriptor === undefined || !('value' in descriptor);
    })
  ) {
    throw new TypeError('Malformed public data node fields');
  }
}

function integer(value: unknown, maximum: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= maximum
  );
}

function nodeArray(value: unknown): unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > MAX_NODES ||
    Reflect.ownKeys(value).length !== value.length + 1
  ) {
    throw new TypeError('Malformed or oversized public data node array');
  }
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor)) {
      throw new TypeError('Public data node arrays must be dense values');
    }
  }
  return value;
}

function pairs(value: unknown): { k: unknown[]; v: unknown[] } {
  const entry = record(value);
  exactFields(entry, ['k', 'v']);
  const keys = nodeArray(entry.k);
  const values = nodeArray(entry.v);
  if (keys.length !== values.length) {
    throw new TypeError('Public data keys and values have different lengths');
  }
  return { k: keys, v: values };
}

/** Validate inert, pure-data Seroval JSON before the decoder can coerce it. */
export function validateSerializedData(
  value: unknown,
): asserts value is SerovalJSON {
  const tree = record(value);
  exactFields(tree, ['t', 'f', 'm']);
  if (!integer(tree.f, 127)) {
    throw new TypeError('Malformed public data feature flags');
  }
  const metadata = nodeArray(tree.m);
  if (
    metadata.some(id => !integer(id, MAX_NODES)) ||
    new Set(metadata).size !== metadata.length
  ) {
    throw new TypeError('Malformed public data reference metadata');
  }

  const declarations = new Map<number, number>();
  let count = 0;
  const declare = (id: unknown, tag: number): void => {
    if (!integer(id, MAX_NODES)) {
      throw new TypeError('Malformed public data reference id');
    }
    if (declarations.has(id)) {
      throw new TypeError('Duplicate public data reference id');
    }
    declarations.set(id, tag);
  };
  const visit = (input: unknown, depth: number, mapSentinel = false): void => {
    if (++count > MAX_NODES || depth > MAX_DEPTH) {
      throw new TypeError('Public data tree exceeds its size or depth limit');
    }
    const node = record(input);
    const tagDescriptor = Object.getOwnPropertyDescriptor(node, 't');
    if (
      !tagDescriptor ||
      !('value' in tagDescriptor) ||
      !integer(tagDescriptor.value, 26)
    ) {
      throw new TypeError('Malformed public data node tag');
    }
    const tag = tagDescriptor.value as number;

    if (mapSentinel && tag !== 4 && tag !== 26) {
      throw new TypeError('Malformed public data Map sentinel');
    }
    switch (tag) {
      case 0:
        exactFields(node, ['t', 's']);
        if (typeof node.s !== 'number' || !Number.isFinite(node.s)) {
          throw new TypeError('Malformed public data number');
        }
        return;
      case 1:
        exactFields(node, ['t', 's']);
        if (typeof node.s !== 'string')
          throw new TypeError('Malformed public data string');
        return;
      case 2:
        exactFields(node, ['t', 's']);
        if (!integer(node.s, 7))
          throw new TypeError('Malformed public data constant');
        return;
      case 3:
        exactFields(node, ['t', 's']);
        if (
          typeof node.s !== 'string' ||
          node.s.length > 10_000 ||
          !/^-?(?:0|[1-9]\d*)$/.test(node.s)
        ) {
          throw new TypeError('Malformed public data bigint');
        }
        return;
      case 4: {
        exactFields(node, ['t', 'i']);
        if (!integer(node.i, MAX_NODES) || !declarations.has(node.i)) {
          throw new TypeError('Missing or forward public data reference');
        }
        if ((declarations.get(node.i) === 26) !== mapSentinel) {
          throw new TypeError(
            'Public data references a Map sentinel as a value',
          );
        }
        return;
      }
      case 5:
        exactFields(node, ['t', 'i', 's']);
        if (typeof node.s !== 'string')
          throw new TypeError('Malformed public data date');
        if (node.s !== '') {
          const timestamp = new Date(node.s);
          if (
            !Number.isFinite(timestamp.getTime()) ||
            timestamp.toISOString() !== node.s
          ) {
            throw new TypeError('Malformed public data date');
          }
        }
        declare(node.i, tag);
        return;
      case 6:
        exactFields(node, ['t', 'i', 'c', 'm']);
        if (
          typeof node.c !== 'string' ||
          typeof node.m !== 'string' ||
          !/^[dgimsuvy]*$/.test(node.m) ||
          new Set(node.m).size !== node.m.length ||
          (node.m.includes('u') && node.m.includes('v'))
        ) {
          throw new TypeError('Malformed public data regular expression');
        }
        declare(node.i, tag);
        return;
      case 7:
        exactFields(node, ['t', 'i', 'a']);
        declare(node.i, tag);
        for (const item of nodeArray(node.a)) visit(item, depth + 1);
        return;
      case 8: {
        exactFields(node, ['t', 'i', 'e', 'f']);
        declare(node.i, tag);
        const entries = pairs(node.e);
        // The native decoder visits each key then its value, not all keys first.
        for (let index = 0; index < entries.k.length; index++) {
          visit(entries.k[index], depth + 1);
          visit(entries.v[index], depth + 1);
        }
        visit(node.f, depth + 1, true);
        return;
      }
      case 9:
        exactFields(node, ['t', 'i', 'a', 'o']);
        if (!integer(node.o, 3))
          throw new TypeError('Malformed public data object flags');
        declare(node.i, tag);
        for (const item of nodeArray(node.a)) {
          // Seroval encodes a sparse array hole as the literal 0, not a node.
          if (item === 0) {
            if (++count > MAX_NODES)
              throw new TypeError('Public data tree exceeds its size limit');
          } else visit(item, depth + 1);
        }
        return;
      case 10:
      case 11: {
        exactFields(node, ['t', 'i', 'p', 'o']);
        if (!integer(node.o, 3))
          throw new TypeError('Malformed public data object flags');
        declare(node.i, tag);
        const properties = pairs(node.p);
        if (
          properties.k.some(key => typeof key !== 'string') ||
          new Set(properties.k).size !== properties.k.length
        ) {
          throw new TypeError('Malformed or duplicate public data object keys');
        }
        for (const item of properties.v) visit(item, depth + 1);
        return;
      }
      case 26:
        exactFields(node, ['t', 'i', 's']);
        if (!mapSentinel || node.s !== 0) {
          throw new TypeError('Unsupported public data special reference');
        }
        declare(node.i, tag);
        return;
      default:
        throw new TypeError('Unsupported public data node');
    }
  };

  visit(tree.t, 0);
  if (metadata.some(id => !declarations.has(id as number))) {
    throw new TypeError('Missing public data metadata reference');
  }
}
