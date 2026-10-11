import assert from 'node:assert/strict';
import { test } from '@rstest/core';
import { fromJSON, toJSON } from 'seroval';
import { validateSerializedData } from '../../src/data/tree';

const wire = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(toJSON(value)));
const tree = (node: unknown, metadata: number[] = []): unknown => ({
  t: node,
  f: 127,
  m: metadata,
});

test('accepts every approved pure-data node including cycles, holes and object flags', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const sparse = [undefined, 'hole', null];
  Reflect.deleteProperty(sparse, 1);
  const set = new Set<unknown>();
  set.add(set);
  const nullObject = Object.assign(Object.create(null), { value: 1 });
  const values = [
    1.25,
    'quote"\n</script>',
    0,
    true,
    false,
    null,
    undefined,
    NaN,
    -0,
    Infinity,
    -Infinity,
    -42n,
    new Date('2026-10-02'),
    new Date('invalid'),
    /foo\/bar/giu,
    cyclic,
    sparse,
    set,
    nullObject,
    Object.freeze({ value: true }),
    Object.seal({ value: 1 }),
    Object.preventExtensions([1]),
  ];
  for (const value of values) {
    const encoded = wire(value);
    validateSerializedData(encoded);
    assert.deepEqual(fromJSON(encoded), value);
  }
});

test('uses native Map traversal order and separates sentinel references from data references', () => {
  const first = {};
  const second = {};
  const inner = new Map<unknown, unknown>([
    [first, second],
    [second, first],
  ]);
  const outer = new Map<unknown, unknown>([[inner, inner]]);
  const cyclic = new Map<unknown, unknown>();
  cyclic.set(cyclic, cyclic);
  for (const value of [[inner, outer], cyclic]) {
    const encoded = wire(value);
    validateSerializedData(encoded);
    assert.deepEqual(fromJSON(encoded), value);
  }
  assert.throws(
    () => validateSerializedData(tree({ t: 26, i: 0, s: 0 })),
    /special reference/,
  );
  assert.throws(
    () =>
      validateSerializedData(
        tree({
          t: 9,
          i: 0,
          o: 0,
          a: [
            { t: 8, i: 1, e: { k: [], v: [] }, f: { t: 26, i: 2, s: 0 } },
            { t: 4, i: 2 },
          ],
        }),
      ),
    /sentinel/,
  );
});

test('rejects missing, forward and duplicate reference ids while allowing a parent cycle', () => {
  for (const node of [
    { t: 4 },
    { t: 4, i: 99 },
    {
      t: 9,
      i: 0,
      o: 0,
      a: [
        { t: 4, i: 1 },
        { t: 10, i: 1, o: 0, p: { k: [], v: [] } },
      ],
    },
    {
      t: 9,
      i: 0,
      o: 0,
      a: [
        { t: 10, i: 1, o: 0, p: { k: [], v: [] } },
        { t: 5, i: 1, s: '' },
      ],
    },
  ])
    assert.throws(() => validateSerializedData(tree(node)), TypeError);
  validateSerializedData(
    tree({ t: 10, i: 0, o: 0, p: { k: ['self'], v: [{ t: 4, i: 0 }] } }, [0]),
  );
});

test('requires exact metadata and node fields instead of accepting decoder coercions', () => {
  for (const node of [
    { t: 0, s: '1' },
    { t: 0, s: null },
    { t: 1 },
    { t: 1, s: {} },
    { t: 2, s: 8 },
    { t: 2, s: '1' },
    { t: 3, s: '1n' },
    { t: 3, s: '01' },
    { t: 5, i: 0, s: 'invalid date' },
    { t: 6, i: 0, c: 'x', m: 'gg' },
    { t: 6, i: 0, c: 'x', m: 'uv' },
    { t: 7, i: 0, a: [0] },
    { t: 8, i: 0, e: { k: [], v: [] }, f: { t: 0, s: 1 } },
    { t: 9, i: 0, a: [1], o: 0 },
    { t: 9, i: 0, a: [], o: 4 },
    { t: 10, i: 0, p: { k: ['x'], v: [] }, o: 0 },
    { t: 10, i: 0, p: { k: [1], v: [{ t: 0, s: 1 }] }, o: 0 },
    {
      t: 10,
      i: 0,
      p: {
        k: ['x', 'x'],
        v: [
          { t: 0, s: 1 },
          { t: 0, s: 2 },
        ],
      },
      o: 0,
    },
    { t: 1, s: 'value', injected: true },
    { t: 18, s: 'globalFunction' },
    { t: 12, i: 0, s: 1, f: { t: 0, s: 1 } },
    { t: 25, c: 'plugin' },
    { t: 31, i: 0 },
  ])
    assert.throws(() => validateSerializedData(tree(node)), TypeError);
  for (const value of [
    null,
    [],
    {},
    { t: { t: 1, s: 'x' }, f: 128, m: [] },
    { t: { t: 1, s: 'x' }, f: 127, m: [1] },
    { t: { t: 10, i: 0, p: { k: [], v: [] }, o: 0 }, f: 127, m: [0, 0] },
    { t: { t: 1, s: 'x' }, f: 127, m: [], injected: true },
  ])
    assert.throws(() => validateSerializedData(value), TypeError);
});

test('does not execute accessor fields while validating structural input', () => {
  let reads = 0;
  const node = Object.defineProperty({ t: 1 }, 's', {
    enumerable: true,
    get() {
      reads++;
      return 'secret';
    },
  });
  assert.throws(() => validateSerializedData(tree(node)), TypeError);
  assert.equal(reads, 0);
  const metadata = Object.defineProperty([], '0', {
    get() {
      reads++;
      return 0;
    },
  });
  assert.throws(
    () => validateSerializedData({ t: { t: 2, s: 1 }, f: 127, m: metadata }),
    TypeError,
  );
  assert.equal(reads, 0);
  assert.throws(
    () => validateSerializedData({ t: { t: 2, s: 1 }, f: 127, m: Array(1) }),
    TypeError,
  );
});

test('bounds node count, nesting, reference ids and bigint decoder input', () => {
  assert.throws(
    () =>
      validateSerializedData(
        tree({
          t: 9,
          i: 0,
          o: 0,
          a: Array.from({ length: 20_000 }, () => ({ t: 0, s: 1 })),
        }),
      ),
    /size/,
  );
  assert.throws(
    () =>
      validateSerializedData(
        tree({ t: 10, i: 20_001, o: 0, p: { k: [], v: [] } }),
      ),
    /reference id/,
  );
  assert.throws(
    () => validateSerializedData(tree({ t: 3, s: '1'.repeat(10_001) })),
    /bigint/,
  );
  let nested: unknown = { t: 0, s: 1 };
  for (let index = 0; index < 302; index++)
    nested = { t: 9, i: index, o: 0, a: [nested] };
  assert.throws(() => validateSerializedData(tree(nested)), /depth/);
});
