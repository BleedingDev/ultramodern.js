import { createRequestSession } from '@modern-js/renderer-core/session';
import {
  getHydrationWriter,
  HydrationScript,
  renderToStream,
  ssr,
} from '@solidjs/web';
import { createComponent, createMemo, createRoot, Loading } from 'solid-js';
import {
  prepareHydratedLoaderData,
  preparePublicLoaderData,
} from '../../src/router-binding/publicMatchData';

const key = 'receiver:actual-native-writer';

function createOwner(bindings: Record<string, unknown> = {}) {
  return createRequestSession({
    request: new Request('https://receiver.test/item'),
    identity: {
      renderer: 'solid',
      appId: 'receiver',
      entryName: 'main',
      protocolVersion: 1,
      buildId: 'build-a',
    },
    platform: { kind: 'node', bindings },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function nativeWriter(value: Promise<unknown>) {
  return renderToStream(
    () => {
      const writer = getHydrationWriter();
      if (!writer) throw new Error('Expected a real native hydration writer.');
      writer.write(key, { ready: 'native-receiver-critical', later: value });
      return [
        createComponent(HydrationScript, {}),
        ssr('<main>native writer shell</main>'),
      ];
    },
    { renderId: 'receiver:' },
  );
}

/** Execute the actual native bootstrap and writer scripts in the same realm.
 * This is a serialization unit decoder; browser parsing and hydration have a
 * separate admission fixture. No registry values are manufactured here. */
function nativeDecoder() {
  const names = ['window', 'self', 'document', '_$HY', '$R'];
  const previous = new Map(
    names.map(name => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  );
  if (previous.get('_$HY'))
    throw new Error('Receiver decoder requires its own clean native registry.');
  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'self', {
    value: globalThis,
    configurable: true,
  });
  // The native bootstrap registers event listeners. A real Node EventTarget
  // supplies that host API; this unit decoder does not dispatch DOM events.
  Object.defineProperty(globalThis, 'document', {
    value: new EventTarget(),
    configurable: true,
  });
  return {
    write(html: string) {
      for (const script of html.matchAll(
        /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g,
      )) {
        // Only our native writer's emitted scripts are executed.
        new Function(script[1])();
      }
    },
    read() {
      const registry = Object.getOwnPropertyDescriptor(
        globalThis,
        '_$HY',
      )?.value;
      const record = registry?.r?.[key];
      if (!record || typeof record !== 'object')
        throw new Error(
          'The actual native writer did not emit its keyed record.',
        );
      return record;
    },
    close() {
      for (const name of names) {
        const descriptor = previous.get(name);
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}

async function receivedFulfilled() {
  const source = Promise.resolve({
    value: 'native-decoded-public',
    nested: ['native-decoded-array'],
  });
  const html = await new Response(nativeWriter(source).readable).text();
  const decoder = nativeDecoder();
  try {
    decoder.write(html);
    return { decoder, record: decoder.read() };
  } catch (error) {
    decoder.close();
    throw error;
  }
}

describe('native keyed receiver metadata', () => {
  test('real native settled metadata adopts a checked handle before direct memo reads it', async () => {
    const { decoder, record } = await receivedFulfilled();
    try {
      const original = Object.getOwnPropertyDescriptor(record, 'later')?.value;
      expect(original).toBeInstanceOf(Promise);
      expect(Object.getOwnPropertyDescriptor(original, 's')?.value).toBe(1);
      const originalValue = Object.getOwnPropertyDescriptor(
        original,
        'v',
      )?.value;
      const prepared = prepareHydratedLoaderData(record, createOwner());
      const handle = Object.getOwnPropertyDescriptor(prepared, 'later')?.value;
      expect(handle === original).toBe(false);
      expect(Object.isSealed(handle)).toBe(true);
      let selected: unknown;
      const native = renderToStream(() => {
        selected = createMemo(() => handle)();
        return ssr(
          ['<p>', '</p>'],
          () => Object.getOwnPropertyDescriptor(selected, 'value')?.value,
        );
      });
      expect(await new Response(native.readable).text()).toContain(
        'native-decoded-public',
      );
      expect(Object.isFrozen(selected)).toBe(true);
      expect(
        Object.isFrozen(
          Object.getOwnPropertyDescriptor(selected, 'nested')?.value,
        ),
      ).toBe(true);
      expect(Object.isFrozen(originalValue)).toBe(false);
      expect(
        Object.getOwnPropertyDescriptor(original, 'v')?.value === originalValue,
      ).toBe(true);
    } finally {
      decoder.close();
    }
  });

  test('authored loader guard does not accept real decoded native s/v metadata', async () => {
    const { decoder, record } = await receivedFulfilled();
    try {
      expect(() => preparePublicLoaderData(record, createOwner())).toThrow(
        /custom Promise properties/,
      );
    } finally {
      decoder.close();
    }
  });

  test('a real native pending slot resolves through the receiver and native direct memo', async () => {
    const source = deferred<unknown>();
    const reader = nativeWriter(source.promise).readable.getReader();
    const decoder = nativeDecoder();
    const fulfilled = { value: 'native-pending-receiver-value' };
    try {
      decoder.write(new TextDecoder().decode((await reader.read()).value));
      const record = decoder.read();
      const original = Object.getOwnPropertyDescriptor(record, 'later')?.value;
      expect(original).toBeInstanceOf(Promise);
      expect(Object.getOwnPropertyDescriptor(original, 's')?.value).not.toBe(1);
      const prepared = prepareHydratedLoaderData(record, createOwner());
      const handle = Object.getOwnPropertyDescriptor(prepared, 'later')?.value;
      let selected: unknown;
      const native = renderToStream(() => {
        const memo = createMemo(() => handle);
        return createComponent(Loading, {
          fallback: ssr('<p>native pending receiver</p>'),
          get children() {
            selected = memo();
            return ssr(
              ['<p>', '</p>'],
              () => Object.getOwnPropertyDescriptor(selected, 'value')?.value,
            );
          },
        });
      });
      const rendering = new Response(native.readable).text();
      source.resolve(fulfilled);
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        decoder.write(new TextDecoder().decode(chunk.value));
      }
      expect(await rendering).toContain('native-pending-receiver-value');
      expect(Object.isFrozen(selected)).toBe(true);
      expect((await handle) === selected).toBe(true);
      expect(Object.isFrozen(fulfilled)).toBe(false);
      expect(Object.getOwnPropertyDescriptor(original, 's')?.value).toBe(1);
    } finally {
      source.resolve(fulfilled);
      decoder.close();
    }
  });

  test('a real native rejected slot retains checked synchronous rejection metadata', async () => {
    const source = deferred<unknown>();
    const native = nativeWriter(source.promise);
    const reading = new Response(native.readable).text();
    source.reject({ message: 'native-public-rejection' });
    const html = await reading;
    const decoder = nativeDecoder();
    try {
      decoder.write(html);
      const record = decoder.read();
      const original = Object.getOwnPropertyDescriptor(record, 'later')?.value;
      // Adopt in the same turn as native decoding; no browser event behavior is
      // inferred from this unit decoder's synchronous receiver call.
      const prepared = prepareHydratedLoaderData(record, createOwner());
      const handle = Object.getOwnPropertyDescriptor(prepared, 'later')?.value;
      expect(Object.getOwnPropertyDescriptor(original, 's')?.value).toBe(2);
      expect(Object.getOwnPropertyDescriptor(handle, 's')?.get?.()).toBe(2);
      let thrown: unknown;
      try {
        createRoot(dispose => {
          try {
            createMemo(() => handle)();
          } finally {
            dispose();
          }
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toMatchObject({ message: 'native-public-rejection' });
      expect(Object.isFrozen(thrown)).toBe(true);
      await expect(handle).rejects.toMatchObject({
        message: 'native-public-rejection',
      });
    } finally {
      decoder.close();
    }
  });

  const malformed: Array<
    readonly [string, (promise: Promise<unknown>, onRead: () => string) => void]
  > = [
    [
      's accessor',
      (promise, onRead) => {
        Object.defineProperty(promise, 's', { get: onRead });
      },
    ],
    [
      'v accessor',
      (promise, onRead) => {
        Object.defineProperty(promise, 'v', { get: onRead });
      },
    ],
    [
      'symbol property',
      promise => {
        Object.defineProperty(promise, Symbol('unexpected'), { value: true });
      },
    ],
    [
      'extra property',
      promise => {
        Object.defineProperty(promise, 'extra', { value: true });
      },
    ],
    [
      'async iterable d field',
      promise => {
        Object.defineProperty(promise, 'd', { value: false });
      },
    ],
    [
      'unsupported state 3',
      promise => {
        Reflect.set(promise, 's', 3);
      },
    ],
    [
      'string state',
      promise => {
        Reflect.set(promise, 's', '1');
      },
    ],
    [
      'missing status',
      promise => {
        Reflect.deleteProperty(promise, 's');
      },
    ],
    [
      'missing settled value',
      promise => {
        Reflect.deleteProperty(promise, 'v');
      },
    ],
  ];

  test.each(
    malformed,
  )('receiver rejects real decoded Promise with %s without reading getters', async (_name, mutate) => {
    const { decoder, record } = await receivedFulfilled();
    let getterCalls = 0;
    try {
      const original = Object.getOwnPropertyDescriptor(record, 'later')?.value;
      mutate(original, () => {
        getterCalls += 1;
        return 'unexpected-native-private-value';
      });
      let result: unknown;
      expect(() => {
        result = prepareHydratedLoaderData(record, createOwner());
      }).toThrow();
      expect(result).toBeUndefined();
      expect(getterCalls).toBe(0);
    } finally {
      decoder.close();
    }
  });

  test('receiver rejects a decoded private bindings v before returning a public graph', async () => {
    const { decoder, record } = await receivedFulfilled();
    const bindings = { token: 'private-receiver-binding' };
    try {
      const original = Object.getOwnPropertyDescriptor(record, 'later')?.value;
      Reflect.set(original, 'v', bindings);
      let result: unknown;
      expect(() => {
        result = prepareHydratedLoaderData(record, createOwner(bindings));
      }).toThrow(/private request references/);
      expect(result).toBeUndefined();
      expect(Object.isFrozen(bindings)).toBe(false);
      expect(
        Object.getOwnPropertyDescriptor(original, 'v')?.value === bindings,
      ).toBe(true);
    } finally {
      decoder.close();
    }
  });
});
