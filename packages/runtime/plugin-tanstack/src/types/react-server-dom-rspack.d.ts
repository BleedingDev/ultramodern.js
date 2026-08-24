// react-server-dom-rspack does not publish TypeScript declarations. This is the
// smallest ambient contract used by the TanStack RSC stream bridge; executable
// decoder tests cover the exact audited upstream development dependency.
declare module 'react-server-dom-rspack/client.edge' {
  export function createFromReadableStream<T>(
    stream: ReadableStream<Uint8Array>,
  ): Promise<T>;
}
