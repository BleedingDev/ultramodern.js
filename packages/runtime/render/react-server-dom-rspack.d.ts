// The upstream Rspack Flight package does not publish TypeScript declarations.
// Keep this ambient surface intentionally limited to the APIs consumed by
// @modern-js/render. Runtime compatibility is covered by the RSC integration
// suites against the exact patched upstream development dependency.

declare module 'react-server-dom-rspack/client.browser' {
  export type CallServerCallback = (
    id: string,
    args: unknown[],
  ) => Promise<unknown>;

  export function createFromFetch<T>(response: Promise<Response>): Promise<T>;

  export function createFromReadableStream<T>(
    stream: ReadableStream<Uint8Array>,
  ): Promise<T>;

  export function createServerReference(
    id: string,
  ): (...args: unknown[]) => Promise<unknown>;

  export function createTemporaryReferenceSet(): WeakMap<object, unknown>;

  export function encodeReply(
    value: unknown,
    options?: { signal?: AbortSignal },
  ): Promise<FormData | string>;

  export function setServerCallback(callback: CallServerCallback): void;
}

declare module 'react-server-dom-rspack/client.edge' {
  export function createFromReadableStream<T>(
    stream: ReadableStream<Uint8Array>,
  ): Promise<T>;
}

declare module 'react-server-dom-rspack/client.node' {
  export function createFromReadableStream<T>(
    stream: ReadableStream<Uint8Array>,
  ): Promise<T>;
}

declare module 'react-server-dom-rspack/server.edge' {
  export function decodeReply<T extends unknown[] = unknown[]>(
    body: FormData | string,
  ): Promise<T>;

  export function loadServerAction(
    actionId: string,
  ): ((...args: unknown[]) => unknown) | undefined;

  export function registerClientReference<T>(
    reference: T,
    id: string,
    exportName: string,
  ): T;

  export function registerServerReference<
    T extends (...args: unknown[]) => unknown,
  >(reference: T, id: string, exportName: string | null): T;

  export function renderToReadableStream(
    model: unknown,
  ): ReadableStream<Uint8Array>;
}

declare module 'react-server-dom-rspack/server.node' {
  export {
    decodeReply,
    loadServerAction,
    registerClientReference,
    registerServerReference,
    renderToReadableStream,
  } from 'react-server-dom-rspack/server.edge';
}
