declare module 'react-server-dom-rspack/client.edge' {
  import type { TemporaryReferenceSet } from 'react-server-dom-rspack';

  export type { TemporaryReferenceSet };

  export const createTemporaryReferenceSet: (
    ...args: unknown[]
  ) => TemporaryReferenceSet;

  export function createServerReference(
    id: string,
  ): (...args: unknown[]) => Promise<unknown>;

  export type EncodeFormActionCallback = <A>(
    id: unknown,
    args: Promise<A>,
  ) => ReactCustomFormAction;

  export type ReactCustomFormAction = {
    name?: string;
    action?: string;
    encType?: string;
    method?: string;
    target?: string;
    data?: null | FormData;
  };

  export interface Options {
    nonce?: string;
    encodeFormAction?: EncodeFormActionCallback;
    temporaryReferences?: TemporaryReferenceSet;
    replayConsoleLogs?: boolean;
    environmentName?: string;
    debugChannel?: {
      readable?: ReadableStream;
    };
  }

  export function createFromFetch<T>(
    promiseForResponse: Promise<Response>,
    options?: Options,
  ): Promise<T>;

  export function createFromReadableStream<T>(
    stream: ReadableStream,
    options?: Options,
  ): Promise<T>;

  export const encodeReply: (
    value: unknown,
    options?: {
      temporaryReferences?: TemporaryReferenceSet;
      signal?: AbortSignal;
    },
  ) => Promise<string | FormData>;
}
