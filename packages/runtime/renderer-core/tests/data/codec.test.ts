import { describe, expect, it } from '@rstest/core';
import { fromJSON, toJSON } from 'seroval';
import {
  assertPublicData,
  DATA_CODEC,
  DataProtocolError,
  escapeInlineDataJSON,
  parsePublicData,
  serializePublicData,
} from '../../src/data/codec';

describe('public data codec', () => {
  it('round trips the approved rich values, shared identity and cycles', () => {
    const shared = { value: 1 };
    const array = [shared, shared, shared];
    Reflect.deleteProperty(array, 1);
    const data: Record<string, unknown> = {
      number: [NaN, -0, Infinity, -Infinity],
      boolean: true,
      null: null,
      undefined,
      bigint: 9007199254740993n,
      date: new Date('2026-10-02T12:00:00Z'),
      regexp: /foo/giu,
      map: new Map([['shared', shared]]),
      set: new Set([shared]),
      array,
    };
    data.self = data;
    const result = parsePublicData(serializePublicData(data)) as typeof data;
    expect(result).toEqual(data);
    expect(result.self).toBe(result);
    const decodedArray = result.array as unknown[];
    expect(decodedArray[0]).toBe(decodedArray[2]);
    expect(1 in decodedArray).toBe(false);
    expect((result.map as Map<string, unknown>).get('shared')).toBe(
      decodedArray[0],
    );
  });

  it('makes every script-breaking character inert and remains JSON', () => {
    const value = '</script><script>alert(1)</script>&\u2028\u2029';
    const text = serializePublicData(value);
    expect(text).not.toMatch(/[<>&\u2028\u2029]/u);
    expect(parsePublicData(text)).toBe(value);
    expect(escapeInlineDataJSON(text)).toBe(text);
    const chunks = [text.slice(0, 19), text.slice(19, 31), text.slice(31)];
    expect(chunks.join('')).not.toMatch(/<\/script/i);
  });

  it('uses a structured JSON tree that decodes without dynamic evaluation', () => {
    const text = serializePublicData({ value: 'globalThis.secret = 1' });
    const envelope = JSON.parse(text);
    expect(envelope.codec).toBe(DATA_CODEC);
    expect(typeof envelope.data.t).toBe('object');
    const originalEval = Object.getOwnPropertyDescriptor(
      globalThis,
      'eval',
    )!.value;
    const originalFunction = globalThis.Function;
    const denied = () => {
      throw new Error('Dynamic evaluation is forbidden by CSP');
    };
    Object.defineProperty(globalThis, 'eval', {
      value: denied,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'Function', {
      value: denied,
      configurable: true,
      writable: true,
    });
    try {
      expect(parsePublicData(text)).toEqual({ value: 'globalThis.secret = 1' });
    } finally {
      Object.defineProperty(globalThis, 'eval', {
        value: originalEval,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(globalThis, 'Function', {
        value: originalFunction,
        configurable: true,
        writable: true,
      });
    }
  });

  it('rejects functions, symbols, native views, promises and request-owned objects', () => {
    for (const value of [
      () => undefined,
      Symbol('view'),
      { component: () => undefined },
      { $$typeof: Symbol.for('react.element') },
      new Request('https://example.test', {
        headers: { authorization: 'secret' },
      }),
      new AbortController(),
      new Error('secret'),
      Promise.resolve('later'),
    ]) {
      expect(() => serializePublicData(value)).toThrow(DataProtocolError);
    }
  });

  it('rejects accessors without reading them', () => {
    let reads = 0;
    const value = Object.defineProperty({}, 'secret', {
      enumerable: true,
      get() {
        reads++;
        return 'private';
      },
    });
    expect(() => serializePublicData(value)).toThrow(/accessors/);
    expect(reads).toBe(0);
  });

  it('rejects poisoned Map and Set iterators before accessing container contents', () => {
    for (const value of [new Map([['public', 'value']]), new Set(['value'])]) {
      let reads = 0;
      Object.defineProperty(value, Symbol.iterator, {
        get() {
          reads++;
          throw new Error('The container iterator must never execute');
        },
      });
      expect(() => serializePublicData(value)).toThrow(/symbols or accessors/);
      expect(reads).toBe(0);
    }
  });

  it('rejects nonenumerable rich-value method overrides without calling them', () => {
    for (const [value, method] of [
      [new Date('2026-10-02T12:00:00Z'), 'getTime'],
      [new Date('2026-10-02T12:00:00Z'), 'toISOString'],
      [new Date('2026-10-02T12:00:00Z'), 'valueOf'],
      [/foo/giu, 'toString'],
      [new Map([['public', 'value']]), 'entries'],
      [new Set(['value']), 'keys'],
      [new Set(['value']), 'values'],
    ] as const) {
      let calls = 0;
      Object.defineProperty(value, method, {
        enumerable: false,
        value() {
          calls++;
          throw new Error('The method override must never execute');
        },
      });
      expect(() => serializePublicData(value)).toThrow(
        /Unsupported public data type: function/,
      );
      expect(calls).toBe(0);
    }
  });

  it('rejects RegExp source and flag accessors before native serialization reads them', () => {
    for (const property of ['source', 'flags']) {
      let reads = 0;
      const value = Object.defineProperty(/foo/giu, property, {
        get() {
          reads++;
          return 'private';
        },
      });
      expect(() => serializePublicData(value)).toThrow(/accessors/);
      expect(reads).toBe(0);
    }
  });

  it('rejects private context hidden in nonenumerable properties', () => {
    for (const context of [
      new Headers({ authorization: 'secret' }),
      new Request('https://example.test', {
        headers: { authorization: 'secret' },
      }),
    ]) {
      const value = Object.defineProperty({}, 'context', {
        enumerable: false,
        value: context,
      });
      expect(() => serializePublicData(value)).toThrow(/request context/);
    }
  });

  it('rejects prototype-spoofed native containers before a serializer can choose its own node type', () => {
    for (const prototype of [
      Array.prototype,
      Date.prototype,
      RegExp.prototype,
      Map.prototype,
      Set.prototype,
    ]) {
      expect(() => assertPublicData(Object.create(prototype))).toThrow(
        /valid native container values/,
      );
    }
  });

  it('rejects inert rich-container shadows rather than changing native serialization', () => {
    for (const [value, property, shadow] of [
      [new Date(), 'valueOf', null],
      [new Date(), 'toISOString', 'blocked'],
      [new Map(), 'entries', null],
      [new Set(), 'keys', null],
      [/foo/g, 'source', 123],
      [/foo/g, 'flags', 123],
      [/foo/g, 'global', false],
    ] as const) {
      Object.defineProperty(value, property, { value: shadow });
      expect(() => assertPublicData(value)).toThrow(/must not override/);
    }
  });

  it('rejects array metadata that the pinned serializer silently drops', () => {
    const example = Object.assign([1], { extra: 'public metadata' });
    const unguarded = fromJSON(toJSON(example));
    expect(unguarded).toEqual([1]);
    expect(Object.hasOwn(unguarded, 'extra')).toBe(false);

    for (const enumerable of [true, false]) {
      for (const key of [
        'extra',
        '01',
        '1.0',
        '1e0',
        '1.5',
        '-0',
        '-1',
        'NaN',
        'Infinity',
        '4294967295',
      ]) {
        const value = Object.defineProperty([1], key, {
          enumerable,
          value: 'public metadata',
        });
        expect(() => assertPublicData(value)).toThrow(/canonical index/);
        expect(() => serializePublicData(value)).toThrow(/canonical index/);
        expect(() => serializePublicData({ nested: value })).toThrow(
          /canonical index/,
        );
      }
    }
  });

  it('preserves sparse arrays, explicit undefined, nonenumerable indexes and shared values', () => {
    const shared = { public: 'value' };
    const value = new Array(5);
    value[1] = undefined;
    Object.defineProperty(value, '2', { value: shared });
    value[4] = shared;
    const result = parsePublicData(serializePublicData(value)) as unknown[];
    expect(result.length).toBe(5);
    expect(Object.hasOwn(result, '0')).toBe(false);
    expect(Object.hasOwn(result, '1')).toBe(true);
    expect(result[1]).toBeUndefined();
    expect(Object.hasOwn(result, '2')).toBe(true);
    expect(Object.hasOwn(result, '3')).toBe(false);
    expect(result[2]).toEqual(shared);
    expect(result[2]).toBe(result[4]);
  });

  it('rejects array index and metadata accessors without reading them', () => {
    for (const key of ['0', 'extra']) {
      let reads = 0;
      const value = Object.defineProperty(new Array(1), key, {
        get() {
          reads++;
          throw new Error('The array accessor must never execute');
        },
      });
      expect(() => serializePublicData(value)).toThrow(/accessors/);
      expect(reads).toBe(0);
    }
  });

  it('rejects schema mismatches, malformed references and non-data node tags', () => {
    expect(() => parsePublicData('{}')).toThrow(DataProtocolError);
    expect(() => parsePublicData('invalid')).toThrow(DataProtocolError);
    expect(() =>
      parsePublicData(JSON.stringify({ codec: 'other', data: {} })),
    ).toThrow(/codec/);
    for (const node of [
      { t: 25, c: 'executable-plugin', s: 'secret' },
      { t: 18, s: 'globalFunction' },
      { t: 12, i: 0, s: 0 },
      { t: 26, i: 0, s: 1 },
      { t: 4, i: 100 },
      { t: 999 },
    ]) {
      const text = JSON.stringify({
        codec: DATA_CODEC,
        data: { t: node, f: 127, m: [] },
      });
      expect(() => parsePublicData(text)).toThrow(DataProtocolError);
    }
  });

  it('bounds public payload byte size and nesting', () => {
    expect(() => serializePublicData('x'.repeat(1024 * 1024))).toThrow(
      /byte limit/,
    );
    expect(() => parsePublicData('x'.repeat(1024 * 1024 + 1))).toThrow(
      /byte limit/,
    );
    let deep: unknown = {};
    for (let index = 0; index < 110; index++) deep = { next: deep };
    expect(() => serializePublicData(deep)).toThrow(/depth limit/);
  });

  it('applies the byte limit after HTML escaping so accepted output can decode', () => {
    const accepted = '&'.repeat(100_000);
    expect(parsePublicData(serializePublicData(accepted))).toBe(accepted);
    expect(() => serializePublicData('&'.repeat(200_000))).toThrow(
      /byte limit/,
    );
  });

  it('rejects rich values that exceed decoder structural limits before emitting', () => {
    expect(() => serializePublicData(10n ** 10000n)).toThrow(/codec limits/);
    expect(() => serializePublicData(new Array(20000))).toThrow(/codec limits/);
  });
});
