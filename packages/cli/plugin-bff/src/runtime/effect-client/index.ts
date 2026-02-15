import { FetchHttpClient, HttpApiClient } from '@effect/platform';
import type * as HttpApi from '@effect/platform/HttpApi';
import type * as HttpApiGroup from '@effect/platform/HttpApiGroup';
import type * as Rpc from '@effect/rpc/Rpc';
import * as RpcClient from '@effect/rpc/RpcClient';
import type * as RpcGroup from '@effect/rpc/RpcGroup';
import * as RpcSerialization from '@effect/rpc/RpcSerialization';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as ManagedRuntime from 'effect/ManagedRuntime';

export * as HttpApi from '@effect/platform/HttpApi';
export * as HttpApiClient from '@effect/platform/HttpApiClient';
export * as HttpApiEndpoint from '@effect/platform/HttpApiEndpoint';
export * as HttpApiGroup from '@effect/platform/HttpApiGroup';
export * as HttpApiSchema from '@effect/platform/HttpApiSchema';
export * as Effect from 'effect/Effect';
export * as Layer from 'effect/Layer';
export * as Schema from 'effect/Schema';
export * as Rpc from '@effect/rpc/Rpc';
export * as RpcClient from '@effect/rpc/RpcClient';
export * as RpcGroup from '@effect/rpc/RpcGroup';
export * as RpcSchema from '@effect/rpc/RpcSchema';
export * as RpcSerialization from '@effect/rpc/RpcSerialization';

export type EffectHttpApiClientOptions = {
  baseUrl?: URL | string;
};

type Nullish = null | undefined;
type NonNullish<T> = Exclude<T, Nullish>;
type PreserveNullish<T, Next> = Extract<T, Nullish> extends never
  ? Next
  : Next | Extract<T, Nullish>;

type EffectViewObjectSelection<T> = NonNullish<T> extends Record<
  string,
  unknown
>
  ? EffectViewSelection<NonNullish<T>>
  : never;

type EffectViewSelectionValue<T> = NonNullish<T> extends readonly (infer Item)[]
  ? true | EffectViewObjectSelection<Item>
  : NonNullish<T> extends Record<string, unknown>
    ? true | EffectViewSelection<NonNullish<T>>
    : true;

type EffectMaskedValue<T, Selection> = Selection extends true
  ? T
  : NonNullish<T> extends readonly (infer Item)[]
    ? PreserveNullish<T, Array<EffectMaskedValue<Item, Selection>>>
    : NonNullish<T> extends Record<string, unknown>
      ? PreserveNullish<T, EffectViewData<NonNullish<T>, Selection>>
      : T;

export type EffectViewSelection<T> = {
  [K in keyof T]?: EffectViewSelectionValue<T[K]>;
};

export type EffectViewData<T, Selection> = Selection extends true
  ? T
  : Selection extends Record<string, unknown>
    ? {
        [K in keyof Selection & keyof T]: EffectMaskedValue<T[K], Selection[K]>;
      }
    : T;

export type EffectRpcSerialization =
  | 'json'
  | 'ndjson'
  | 'jsonRpc'
  | 'ndJsonRpc'
  | 'msgPack';

export type EffectRpcClientOptions<Flatten extends boolean = false> = {
  url: string;
  flatten?: Flatten;
  serialization?: EffectRpcSerialization;
};

export type EffectRpcClientHandle<
  Rpcs extends Rpc.Any,
  Flatten extends boolean = false,
> = (Flatten extends true
  ? RpcClient.RpcClient.Flat<Rpcs, unknown>
  : RpcClient.RpcClient<Rpcs, unknown>) & {
  dispose: () => Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function applySelection(value: unknown, selection: unknown): unknown {
  if (selection === true || selection === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(item => applySelection(item, selection));
  }

  if (!isRecord(value) || !isRecord(selection)) {
    return value;
  }

  const masked: Record<string, unknown> = {};
  for (const key of Object.keys(selection)) {
    if (!(key in value)) {
      continue;
    }
    masked[key] = applySelection(value[key], selection[key]);
  }
  return masked;
}

export function view<T>() {
  return <const Selection extends EffectViewSelection<T>>(
    selection: Selection,
  ) => selection;
}

export function mask<T, const Selection extends EffectViewSelection<T>>(
  value: T,
  selection: Selection,
): EffectViewData<T, Selection> {
  return applySelection(value, selection) as EffectViewData<T, Selection>;
}

export function runEffectView<
  T,
  const Selection extends EffectViewSelection<T>,
>(
  request: PromiseLike<T>,
  selection: Selection,
): Promise<EffectViewData<T, Selection>> {
  return new Promise((resolve, reject) => {
    request.then(
      value => resolve(mask(value, selection)),
      reason => reject(reason),
    );
  });
}

function getRpcSerializationLayer(
  serialization: EffectRpcSerialization | undefined,
) {
  switch (serialization) {
    case 'ndjson':
      return RpcSerialization.layerNdjson;
    case 'jsonRpc':
      return RpcSerialization.layerJsonRpc();
    case 'ndJsonRpc':
      return RpcSerialization.layerNdJsonRpc();
    case 'msgPack':
      return RpcSerialization.layerMsgPack;
    default:
      return RpcSerialization.layerJson;
  }
}

export function makeEffectHttpApiClient<
  ApiId extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  ApiError,
  ApiR,
>(
  api: HttpApi.HttpApi<ApiId, Groups, ApiError, ApiR>,
  options?: EffectHttpApiClientOptions,
) {
  return HttpApiClient.make(api, {
    baseUrl: options?.baseUrl,
  }).pipe(Effect.provide(FetchHttpClient.layer));
}

export function makeEffectRpcClient<
  Rpcs extends Rpc.Any,
  const Flatten extends boolean = false,
>(group: RpcGroup.RpcGroup<Rpcs>, options: EffectRpcClientOptions<Flatten>) {
  const runtimeLayer = Layer.provide(
    Layer.mergeAll(
      RpcClient.layerProtocolHttp({
        url: options.url,
      }),
      Layer.scope,
    ),
    Layer.mergeAll(
      getRpcSerializationLayer(options.serialization),
      FetchHttpClient.layer,
    ),
  );

  return Effect.tryPromise({
    try: async () => {
      const runtime = ManagedRuntime.make(runtimeLayer);
      const client = await runtime.runPromise(
        RpcClient.make(group, {
          flatten: options.flatten,
        }),
      );
      return Object.assign(client, {
        dispose: () => runtime.dispose(),
      }) as EffectRpcClientHandle<Rpcs, Flatten>;
    },
    catch: error => (error instanceof Error ? error : new Error(String(error))),
  });
}

export const runEffectRequest = Effect.runPromise;
