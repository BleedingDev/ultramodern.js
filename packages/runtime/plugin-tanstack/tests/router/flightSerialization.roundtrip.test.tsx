import type React from 'react';
import { isValidElement } from 'react';
import { createRscProxy } from '../../src/runtime/rsc/createRscProxy';
import {
  reviveTanstackRscFlightValues,
  serializeTanstackRscFlightValues,
} from '../../src/runtime/rsc/flightSerialization';
import {
  RENDERABLE_RSC,
  SERVER_COMPONENT_STREAM,
  type ServerComponentStream,
} from '../../src/runtime/rsc/symbols';

type RoundTripFixture = {
  bigintValue: bigint;
  booleanValue: boolean;
  circular: Record<string, unknown>;
  dateValue: Date;
  falseValue: boolean;
  mapValue: Map<unknown, unknown>;
  nested: {
    array: unknown[];
    object: {
      child: unknown;
    };
  };
  nullValue: null;
  numberValue: number;
  rscProxy: React.ReactElement & Record<PropertyKey, unknown>;
  setValue: Set<unknown>;
  sharedA: Record<string, unknown>;
  sharedB: Record<string, unknown>;
  stringValue: string;
  undefinedValue: undefined;
};

function createStream(): ServerComponentStream {
  return {
    createReplayStream: () => new ReadableStream<Uint8Array>(),
  };
}

test('round-trips TanStack RSC flight values across supported value types', async () => {
  const shared = { marker: 'shared' };
  const circular: Record<string, unknown> = { marker: 'circular' };
  circular.self = circular;

  const mapValue = new Map<unknown, unknown>([
    ['primitive', 1],
    ['shared', shared],
    [shared, circular],
  ]);
  mapValue.set('self', mapValue);

  const setValue = new Set<unknown>(['set-item', shared, circular]);
  setValue.add(setValue);

  const rscProxy = createRscProxy(() => ({ slot: 'server' }), {
    renderable: true,
    stream: createStream(),
  }) as React.ReactElement & Record<PropertyKey, unknown>;

  const fixture: RoundTripFixture = {
    bigintValue: 9007199254740993n,
    booleanValue: true,
    circular,
    dateValue: new Date('2026-07-08T12:34:56.789Z'),
    falseValue: false,
    mapValue,
    nested: {
      array: [shared, [null, undefined, 7n]],
      object: {
        child: shared,
      },
    },
    nullValue: null,
    numberValue: 42,
    rscProxy,
    setValue,
    sharedA: shared,
    sharedB: shared,
    stringValue: 'flight',
    undefinedValue: undefined,
  };

  const serialized = serializeTanstackRscFlightValues(
    fixture,
  ) as RoundTripFixture;
  const revived = (await reviveTanstackRscFlightValues(
    serialized,
  )) as RoundTripFixture;

  expect(revived).not.toBe(fixture);
  expect(revived.stringValue).toBe('flight');
  expect(revived.numberValue).toBe(42);
  expect(revived.booleanValue).toBe(true);
  expect(revived.falseValue).toBe(false);
  expect(revived.nullValue).toBeNull();
  expect(Object.hasOwn(revived, 'undefinedValue')).toBe(true);
  expect(revived.undefinedValue).toBeUndefined();
  expect(revived.bigintValue).toBe(9007199254740993n);
  expect(revived.dateValue).toBeInstanceOf(Date);
  expect(revived.dateValue.toISOString()).toBe('2026-07-08T12:34:56.789Z');

  expect(revived.nested.array[0]).toBe(revived.sharedA);
  expect(revived.nested.object.child).toBe(revived.sharedA);
  expect(revived.sharedB).toBe(revived.sharedA);

  expect(revived.circular).not.toBe(circular);
  expect(revived.circular.self).toBe(revived.circular);

  expect(revived.mapValue).toBeInstanceOf(Map);
  expect(revived.mapValue).not.toBe(mapValue);
  expect(revived.mapValue.get('primitive')).toBe(1);
  expect(revived.mapValue.get('shared')).toBe(revived.sharedA);
  expect(revived.mapValue.get(revived.sharedA)).toBe(revived.circular);
  expect(revived.mapValue.get('self')).toBe(revived.mapValue);

  expect(revived.setValue).toBeInstanceOf(Set);
  expect(revived.setValue).not.toBe(setValue);
  expect(revived.setValue.has('set-item')).toBe(true);
  expect(revived.setValue.has(revived.sharedA)).toBe(true);
  expect(revived.setValue.has(revived.circular)).toBe(true);
  expect(revived.setValue.has(revived.setValue)).toBe(true);

  expect(serialized.rscProxy).not.toBe(rscProxy);
  expect(serialized.rscProxy).toMatchObject({
    __modernTanstackRsc: true,
    kind: 'renderable',
  });
  expect(serialized.rscProxy.stream).toBeInstanceOf(ReadableStream);

  expect(revived.rscProxy).not.toBe(rscProxy);
  expect(isValidElement(revived.rscProxy)).toBe(true);
  expect(revived.rscProxy[RENDERABLE_RSC]).toBe(true);
  expect(revived.rscProxy[SERVER_COMPONENT_STREAM]).toBeDefined();
});
