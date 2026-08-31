// @effect-diagnostics anyUnknownInErrorContext:off asyncFunction:off newPromise:off strictEffectProvide:off
import {
  createRequestContextHeaders,
  type RequestContextInput,
} from '@modern-js/create-request';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Layer from 'effect/Layer';
import * as ManagedRuntime from 'effect/ManagedRuntime';
import * as Scope from 'effect/Scope';
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from 'effect/unstable/http';
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from 'effect/unstable/httpapi';
import {
  Rpc,
  RpcClient,
  RpcGroup,
  RpcSchema,
  RpcSerialization,
} from 'effect/unstable/rpc';

import { getRpcSerializationLayer } from '../effect/rpcSerialization';

export * as Effect from 'effect/Effect';
export * as Layer from 'effect/Layer';
export * as Schema from 'effect/Schema';
export * as HttpClientError from 'effect/unstable/http/HttpClientError';
export {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  Rpc,
  RpcClient,
  RpcGroup,
  RpcSchema,
  RpcSerialization,
};

export type EffectHttpApiClientOptions = {
  baseUrl?: URL | string;
  requestContext?: RequestContextInput;
  transformClient?: (client: HttpClient.HttpClient) => HttpClient.HttpClient;
  transformResponse?:
    | ((
        effect: Effect.Effect<unknown, unknown, unknown>,
      ) => Effect.Effect<unknown, unknown, unknown>)
    | undefined;
};

type Nullish = null | undefined;
type NonNullish<T> = Exclude<T, Nullish>;
type PreserveNullish<T, Next> =
  Extract<T, Nullish> extends never ? Next : Next | Extract<T, Nullish>;

type EffectViewObjectSelection<T> =
  NonNullish<T> extends Record<string, unknown>
    ? EffectViewSelection<NonNullish<T>>
    : never;

type EffectViewSelectionValue<T> =
  NonNullish<T> extends readonly (infer Item)[]
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

export class EffectRpcClientError extends Data.TaggedError(
  'EffectRpcClientError',
)<{
  readonly cause: unknown;
}> {}

type EffectRpcMiddlewareLayerOption<Rpcs extends Rpc.Any> = [
  Rpc.MiddlewareClient<Rpcs>,
] extends [never]
  ? {
      middlewareLayer?: Layer.Layer<Rpc.MiddlewareClient<Rpcs>, never, never>;
    }
  : {
      middlewareLayer: Layer.Layer<Rpc.MiddlewareClient<Rpcs>, unknown, never>;
    };

export type EffectRpcClientOptions<
  Rpcs extends Rpc.Any,
  Flatten extends boolean = false,
> = EffectRpcMiddlewareLayerOption<Rpcs> & {
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
    const selected = selection[key];
    if (
      selected === undefined ||
      !(key in value) ||
      (selected !== true && !isRecord(selected))
    ) {
      continue;
    }
    masked[key] = applySelection(value[key], selected);
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

export function makeEffectHttpApiClient<
  ApiId extends string,
  Groups extends HttpApiGroup.Constraint,
>(
  api: HttpApi.HttpApi<ApiId, Groups>,
  options?: EffectHttpApiClientOptions,
): Effect.Effect<
  HttpApiClient.Client<Groups, never, never>,
  never,
  HttpApiGroup.MiddlewareClient<Groups>
> {
  const requestContextHeaders = createRequestContextHeaders(
    options?.requestContext,
  );
  const transformClient = (client: HttpClient.HttpClient) => {
    const contextClient =
      Object.keys(requestContextHeaders).length === 0
        ? client
        : client.pipe(
            HttpClient.mapRequest(request => {
              let nextRequest = request;
              for (const [header, value] of Object.entries(
                requestContextHeaders,
              )) {
                if (nextRequest.headers[header.toLowerCase()] === undefined) {
                  nextRequest = HttpClientRequest.setHeader(
                    nextRequest,
                    header,
                    value,
                  );
                }
              }
              return nextRequest;
            }),
          );

    return typeof options?.transformClient === 'function'
      ? options.transformClient(contextClient)
      : contextClient;
  };

  return HttpApiClient.make(api, {
    baseUrl: options?.baseUrl,
    transformClient,
    transformResponse: options?.transformResponse,
  }).pipe(Effect.provide(FetchHttpClient.layer));
}

export function makeEffectRpcClient<
  Rpcs extends Rpc.Any,
  const Flatten extends boolean = false,
>(
  group: RpcGroup.RpcGroup<Rpcs>,
  options: EffectRpcClientOptions<Rpcs, Flatten>,
) {
  const protocolLayer = Layer.provide(
    RpcClient.layerProtocolHttp({
      url: options.url,
    }),
    Layer.mergeAll(
      getRpcSerializationLayer(options.serialization),
      FetchHttpClient.layer,
    ),
  );
  const middlewareLayer = options.middlewareLayer ?? Layer.empty;
  const runtimeLayer = Layer.mergeAll(protocolLayer, middlewareLayer);

  return Effect.tryPromise({
    try: async () => {
      const runtime = ManagedRuntime.make(runtimeLayer);
      let scope: Scope.Closeable | undefined;
      try {
        const clientScope = await runtime.runPromise(Scope.make());
        scope = clientScope;
        const client = await runtime.runPromise(
          RpcClient.make(group, {
            flatten: options.flatten,
          }).pipe(Effect.provideService(Scope.Scope, clientScope)),
        );
        let disposePromise: Promise<void> | undefined;
        const clientWithDispose: EffectRpcClientHandle<Rpcs, Flatten> =
          Object.assign(client, {
            dispose: () => {
              disposePromise ??= (async () => {
                let scopeCloseError: unknown;
                try {
                  await runtime.runPromise(Scope.close(clientScope, Exit.void));
                } catch (error) {
                  scopeCloseError = error;
                }
                try {
                  await runtime.dispose();
                } catch (error) {
                  if (scopeCloseError === undefined) {
                    throw error;
                  }
                }
                if (scopeCloseError !== undefined) {
                  throw scopeCloseError;
                }
              })();
              return disposePromise;
            },
          });
        return clientWithDispose;
      } catch (error) {
        if (scope !== undefined) {
          try {
            await runtime.runPromise(Scope.close(scope, Exit.void));
          } catch {
            // ignore scope close errors and preserve the original construction error
          }
        }
        try {
          await runtime.dispose();
        } catch {
          // ignore disposal errors and preserve the original construction error
        }
        throw error;
      }
    },
    catch: (error: unknown) => new EffectRpcClientError({ cause: error }),
  });
}

export const runEffectRequest = Effect.runPromise;
