// @effect-diagnostics asyncFunction:off strictBooleanExpressions:off
/**
 * Fork-owned helper for the per-request router runtime cleanup.
 *
 * Router providers (react-router, @modern-js/plugin-tanstack, ...) register a
 * `cleanup` callback in the router runtime state. For streamed SSR the
 * Response is returned at shell-ready while React is still rendering into the
 * body, so the cleanup must not run until the body finishes — otherwise it
 * can dispose router state that the in-flight render is still using. Cleanup
 * failures are reported through the request's `onError` instead of being
 * swallowed.
 */
import type { OnError } from '@modern-js/app-tools';
import { getRouterRuntimeState } from '../../router/runtime/lifecycle';
import type { TInternalRuntimeContext } from '../context';

export const ROUTER_CLEANUP_ERROR =
  'An error occurs during router runtime cleanup';

export type RouterCleanup = {
  /** True once the cleanup has been tied to a streamed response body. */
  readonly deferred: boolean;
  /** Runs the router cleanup at most once; reports failures via `onError`. */
  run: () => Promise<void>;
  /**
   * Ties the cleanup to the completion (close, error or cancellation) of the
   * response body when it is a stream. Responses without a streaming body are
   * returned as-is and the caller is expected to invoke `run()` itself.
   */
  deferUntilBodyDone: (response: Response) => Response;
};

export async function runWithRouterCleanupOnError<T>(
  routerCleanup: RouterCleanup,
  callback: () => Promise<T> | T,
): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    await routerCleanup.run();
    throw error;
  }
}

export async function finishWithRouterCleanup<T>(
  routerCleanup: RouterCleanup,
  callback: () => Promise<T> | T,
): Promise<T> {
  try {
    return await callback();
  } finally {
    if (!routerCleanup.deferred) {
      await routerCleanup.run();
    }
  }
}

export function createRouterCleanup(
  runtimeContext: TInternalRuntimeContext,
  onError: OnError,
): RouterCleanup {
  let deferred = false;
  let finished = false;

  const run = async (): Promise<void> => {
    if (finished) {
      return;
    }
    finished = true;
    try {
      await getRouterRuntimeState(runtimeContext)?.cleanup?.();
    } catch (error) {
      onError(error, ROUTER_CLEANUP_ERROR);
    }
  };

  const deferUntilBodyDone = (response: Response): Response => {
    const { body } = response;
    if (!body || body.locked) {
      return response;
    }

    deferred = true;
    const reader = body.getReader();
    const wrappedBody = new ReadableStream<Uint8Array>({
      async pull(controller) {
        let result: ReadableStreamReadResult<Uint8Array>;
        try {
          result = await reader.read();
        } catch (error) {
          controller.error(error);
          await run();
          return;
        }
        if (result.done) {
          controller.close();
          await run();
          return;
        }
        controller.enqueue(result.value);
      },
      async cancel(reason) {
        try {
          await reader.cancel(reason);
        } catch {
          // The original body is already errored or closed.
        }
        await run();
      },
    });

    return new Response(wrappedBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };

  return {
    get deferred() {
      return deferred;
    },
    run,
    deferUntilBodyDone,
  };
}
