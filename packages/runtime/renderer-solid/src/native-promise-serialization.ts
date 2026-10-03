import {
  createPlugin,
  type SerovalNode,
  type StreamParsePluginContext,
} from '@solidjs/web/serialization';

const nativeThen = Promise.prototype.then;

class ResolverToken {}

class SettlementToken {
  constructor(
    readonly resolver: ResolverToken,
    readonly value: unknown,
    readonly fulfilled: boolean,
  ) {}
}

interface NativePromise extends Promise<unknown> {
  s?: 1 | 2;
  v?: unknown;
}

interface NativeResolver {
  p: NativePromise;
  s(value: unknown): void;
  f(value: unknown): void;
}

/** This function is emitted as source: it may only reference its own locals
 * and JavaScript globals. The observer belongs to the exact native promise
 * returned to Solid, including before any hydration consumer subscribes. */
function mintNativeResolver(): NativeResolver {
  let accept!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise: NativePromise = new Promise((resolve, fail) => {
    accept = resolve;
    reject = fail;
  });
  const resolver = {
    p: promise,
    s(value: unknown) {
      accept(value);
      promise.s = 1;
      promise.v = value;
    },
    f(value: unknown) {
      reject(value);
      promise.s = 2;
      promise.v = value;
    },
  };
  Promise.prototype.then.call(promise, undefined, () => undefined);
  return resolver;
}

function requireStreamingHydration(): never {
  throw new Error(
    'The Solid native Promise serializer only supports streaming SSR hydration.',
  );
}

const resolverPlugin = createPlugin<ResolverToken, Record<string, never>>({
  tag: 'ultramodern/solid/native-promise-resolver-v1',
  test: value => value instanceof ResolverToken,
  parse: {
    sync: requireStreamingHydration,
    async: requireStreamingHydration,
    stream: () => ({}),
  },
  serialize: () => `(${mintNativeResolver.toString()})()`,
  deserialize: requireStreamingHydration,
});

type SettlementInfo = {
  resolver: SerovalNode;
  value: SerovalNode;
  fulfilled: SerovalNode;
};

const settlementPlugin = createPlugin<SettlementToken, SettlementInfo>({
  tag: 'ultramodern/solid/native-promise-settlement-v1',
  test: value => value instanceof SettlementToken,
  parse: {
    sync: requireStreamingHydration,
    async: requireStreamingHydration,
    stream: (value, context) => ({
      resolver: context.parse(value.resolver),
      value: context.parse(value.value),
      fulfilled: context.parse(value.fulfilled),
    }),
  },
  serialize: (node, context) =>
    `(${context.serialize(node.resolver)})[${context.serialize(node.fulfilled)}?"s":"f"](${context.serialize(node.value)})`,
  deserialize: requireStreamingHydration,
});

type PromiseInfo = {
  resolver: SerovalNode;
};

interface PendingSerialization {
  context: StreamParsePluginContext;
  resolver: ResolverToken;
}

/** Internal SSR-only native plugin. It is deliberately not an application
 * codec or a public client decoder. Seroval owns indexing and settlement
 * chunks; Solid retains its ordinary Promise, s/v and truncation semantics. */
export const nativePromiseSerializationPlugin = createPlugin<
  Promise<unknown>,
  PromiseInfo
>({
  tag: 'ultramodern/solid/native-promise-v1',
  extends: [resolverPlugin, settlementPlugin],
  test: value => value instanceof Promise,
  parse: {
    sync: requireStreamingHydration,
    async: requireStreamingHydration,
    stream(value, context) {
      const resolver = new ResolverToken();
      const node = context.parse(resolver);
      context.pushPendingState();
      let pending: PendingSerialization | undefined = { context, resolver };
      context.addCleanup(() => {
        // Native close/onDone owns completion. Popping here would reenter
        // onDone, and late source reactions must retain neither scope nor token.
        pending = undefined;
      });
      const settle = (result: unknown, fulfilled: boolean) => {
        const current = pending;
        if (!current) return;
        pending = undefined;
        try {
          if (!current.context.isAlive()) return;
          const settlement = current.context.parseWithError(
            new SettlementToken(current.resolver, result, fulfilled),
          );
          if (settlement && current.context.isAlive()) {
            current.context.onParse(settlement);
          }
        } finally {
          if (current.context.isAlive()) {
            current.context.popPendingState();
          }
        }
      };
      try {
        const bridge = nativeThen.call(
          value,
          result => settle(result, true),
          reason => settle(reason, false),
        );
        // Parse/serialize failures already reach the native error hook. If that
        // hook throws, consume the reaction bridge after its native delivery.
        nativeThen.call(bridge, undefined, () => undefined);
      } catch (error) {
        pending = undefined;
        if (context.isAlive()) context.popPendingState();
        throw error;
      }
      return { resolver: node };
    },
  },
  serialize: (node, context) => `(${context.serialize(node.resolver)}).p`,
  deserialize: requireStreamingHydration,
});
