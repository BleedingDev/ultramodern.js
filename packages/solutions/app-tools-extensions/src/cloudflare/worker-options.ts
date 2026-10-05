import type { RequestHandlerOptions } from '@modern-js/server-core';

/** The native context supplied to a Cloudflare module worker's fetch method. */
export interface CloudflareExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

/** Worker request bindings follow the shared RequestPlatform kind/bindings shape. */
export interface CloudflareWorkerPlatform<Bindings extends object = object> {
  readonly kind: 'worker';
  /** The original env object. Direct worker invocations may omit it. */
  readonly bindings: Bindings | undefined;
}

/** Request-owned options for manifest HTML and Flight worker handlers. */
export interface CloudflareWorkerRequestHandlerOptions<
  Bindings extends object = object,
> extends RequestHandlerOptions {
  readonly platform: CloudflareWorkerPlatform<Bindings>;
  /** The original context, including its native method receivers. */
  readonly executionContext: CloudflareExecutionContext | undefined;
}

/** Narrow native handler options without replacing their worker references. */
export function isCloudflareWorkerRequestHandlerOptions(
  options: RequestHandlerOptions,
): options is CloudflareWorkerRequestHandlerOptions {
  if (!('platform' in options) || !('executionContext' in options))
    return false;
  const platform = options.platform;
  if (
    platform === null ||
    typeof platform !== 'object' ||
    !('kind' in platform) ||
    platform.kind !== 'worker' ||
    !('bindings' in platform)
  ) {
    return false;
  }
  const bindings = platform.bindings;
  if (
    bindings !== undefined &&
    (bindings === null ||
      typeof bindings !== 'object' ||
      Array.isArray(bindings))
  ) {
    return false;
  }
  const context = options.executionContext;
  return (
    context === undefined ||
    (context !== null &&
      typeof context === 'object' &&
      'waitUntil' in context &&
      typeof context.waitUntil === 'function' &&
      'passThroughOnException' in context &&
      typeof context.passThroughOnException === 'function')
  );
}
