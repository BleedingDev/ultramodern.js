import { applyRouterRuntimeState } from '../../../src/core/context';
import {
  createRouterCleanup,
  ROUTER_CLEANUP_ERROR,
} from '../../../src/core/server/routerCleanup';

const createContextWithCleanup = (cleanup: () => void | Promise<void>) => {
  const context = {} as any;
  applyRouterRuntimeState(context, {
    framework: 'custom-router',
    cleanup,
  } as any);
  return context;
};

describe('createRouterCleanup', () => {
  it('runs the registered cleanup at most once', async () => {
    let calls = 0;
    const context = createContextWithCleanup(() => {
      calls += 1;
    });
    const routerCleanup = createRouterCleanup(context, () => {});

    await routerCleanup.run();
    await routerCleanup.run();

    expect(calls).toBe(1);
  });

  it('reports cleanup failures through onError instead of swallowing them', async () => {
    const failure = new Error('cleanup failed');
    const onErrorCalls: unknown[][] = [];
    const context = createContextWithCleanup(() => {
      throw failure;
    });
    const routerCleanup = createRouterCleanup(context, (...args: unknown[]) => {
      onErrorCalls.push(args);
    });

    await expect(routerCleanup.run()).resolves.toBeUndefined();

    expect(onErrorCalls).toHaveLength(1);
    expect(onErrorCalls[0]?.[0]).toBe(failure);
    expect(onErrorCalls[0]?.[1]).toBe(ROUTER_CLEANUP_ERROR);
  });

  it('defers cleanup until a streamed body is fully consumed', async () => {
    let cleaned = false;
    const context = createContextWithCleanup(() => {
      cleaned = true;
    });
    const routerCleanup = createRouterCleanup(context, () => {});

    const encoder = new TextEncoder();
    let releaseTail = () => {};
    const tailReleased = new Promise<void>(resolve => {
      releaseTail = resolve;
    });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('<shell>'));
      },
      async pull(controller) {
        await tailReleased;
        controller.enqueue(encoder.encode('<tail>'));
        controller.close();
      },
    });

    const response = routerCleanup.deferUntilBodyDone(new Response(body));
    expect(routerCleanup.deferred).toBe(true);
    expect(cleaned).toBe(false);

    const reader = response.body!.getReader();
    const shell = await reader.read();
    expect(new TextDecoder().decode(shell.value)).toBe('<shell>');
    expect(cleaned).toBe(false);

    releaseTail();
    await reader.read();
    const done = await reader.read();
    expect(done.done).toBe(true);
    expect(cleaned).toBe(true);
  });

  it('runs cleanup when a streamed body is cancelled', async () => {
    let cleaned = false;
    const context = createContextWithCleanup(() => {
      cleaned = true;
    });
    const routerCleanup = createRouterCleanup(context, () => {});

    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('chunk'));
      },
    });

    const response = routerCleanup.deferUntilBodyDone(new Response(body));
    await response.body!.cancel('client disconnected');

    expect(cleaned).toBe(true);
  });

  it('leaves bodyless responses alone so the caller cleans up immediately', () => {
    const context = createContextWithCleanup(() => {});
    const routerCleanup = createRouterCleanup(context, () => {});

    const redirect = new Response(null, {
      status: 302,
      headers: { Location: '/login' },
    });
    const result = routerCleanup.deferUntilBodyDone(redirect);

    expect(result).toBe(redirect);
    expect(routerCleanup.deferred).toBe(false);
  });

  it('runs cleanup exactly once when a discarded response is already bodyless', async () => {
    let cleanupCalls = 0;
    const context = createContextWithCleanup(() => {
      cleanupCalls += 1;
    });
    const routerCleanup = createRouterCleanup(context, () => {});

    await routerCleanup.discardBody(new Response(null, { status: 204 }));

    expect(cleanupCalls).toBe(1);
    await routerCleanup.run();
    expect(cleanupCalls).toBe(1);
  });

  it('does not clean up when discarded-body cancellation rejects', async () => {
    const cancellationFailure = new Error('source still owns the body');
    let cleanupCalls = 0;
    const context = createContextWithCleanup(() => {
      cleanupCalls += 1;
    });
    const routerCleanup = createRouterCleanup(context, () => {});
    const response = new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          throw cancellationFailure;
        },
      }),
    );

    await expect(routerCleanup.discardBody(response)).rejects.toBe(
      cancellationFailure,
    );
    expect(routerCleanup.deferred).toBe(true);
    expect(cleanupCalls).toBe(0);

    await routerCleanup.run();
    expect(cleanupCalls).toBe(1);
  });
});
