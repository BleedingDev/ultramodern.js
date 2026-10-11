import type { RendererIdentity } from '../identity';

export type ResponseHeaders = ReadonlyArray<readonly [string, string]>;

export type DocumentCachePolicy =
  | { readonly mode: 'no-store' | 'private' }
  | { readonly mode: 'public'; readonly maxAgeSeconds: number };

export interface ResponsePolicy {
  readonly kind: 'document' | 'terminal';
  readonly status: number;
  readonly statusText?: string;
  readonly headers: ResponseHeaders;
  readonly cache: DocumentCachePolicy;
}

export interface RequestPlatform<Bindings extends object = object> {
  readonly kind: 'node' | 'worker';
  readonly bindings: Bindings;
}

export type RequestState =
  | 'matching'
  | 'ready'
  | 'rendering'
  | 'committed'
  | 'completed'
  | 'failed'
  | 'aborted';

export interface RequestCompletion {
  readonly state: 'completed' | 'failed' | 'aborted';
  readonly fallback: boolean;
  readonly error?: unknown;
  readonly cleanupErrors: readonly unknown[];
  readonly cacheEligible: boolean;
}

export type RequestCleanup = () => void | Promise<void>;

export interface RequestSession<Bindings extends object = object> {
  readonly request: Request;
  readonly identity: Readonly<RendererIdentity>;
  readonly platform: RequestPlatform<Bindings>;
  readonly signal: AbortSignal;
  readonly state: RequestState;
  readonly responsePolicy: ResponsePolicy | undefined;
  readonly committedPolicy: ResponsePolicy | undefined;
  readonly completion: Promise<RequestCompletion>;
  resolveResponse(policy: ResponsePolicy): void;
  startRendering(): void;
  registerCleanup(cleanup: RequestCleanup): () => void;
  markFallback(): void;
  respond(body: ReadableStream<Uint8Array> | null): Response;
  /** The returned response must deliver this session's final owned stream. */
  ownsResponseBody(response: Response): boolean;
  /** Notify termination. Await completion separately outside owned cleanup. */
  fail(error: unknown): void;
  abort(reason?: unknown): void;
}
