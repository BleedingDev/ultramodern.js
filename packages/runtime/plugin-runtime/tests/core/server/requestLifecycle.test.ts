(
  globalThis as typeof globalThis & {
    __webpack_require__?: { u: (chunkId: unknown) => string };
  }
).__webpack_require__ = {
  u: chunkId => String(chunkId),
};

type RequestHelpers = typeof import('../../../src/core/server/requestHandler');
let createRequestLifecycle: RequestHelpers['createRequestLifecycle'];
let finishWithRequestLifecycle: RequestHelpers['finishWithRequestLifecycle'];
let runWithRequestLifecycleOnError: RequestHelpers['runWithRequestLifecycleOnError'];
let REQUEST_END_ERROR: RequestHelpers['REQUEST_END_ERROR'];

beforeAll(async () => {
  const helpers = await import('../../../src/core/server/requestHandler');
  createRequestLifecycle = helpers.createRequestLifecycle;
  finishWithRequestLifecycle = helpers.finishWithRequestLifecycle;
  runWithRequestLifecycleOnError = helpers.runWithRequestLifecycleOnError;
  REQUEST_END_ERROR = helpers.REQUEST_END_ERROR;
});

describe('createRequestLifecycle', () => {
  it('reports the first terminal state at most once', async () => {
    const terminals: unknown[] = [];
    const lifecycle = createRequestLifecycle(
      terminal => {
        terminals.push(terminal);
      },
      () => {},
    );

    await lifecycle.run();
    await lifecycle.run({ status: 'cancelled', reason: 'too late' });

    expect(terminals).toEqual([{ status: 'complete' }]);
  });

  it('awaits asynchronous completion without calling the hook twice', async () => {
    const events: string[] = [];
    let releaseEnd = () => {};
    let reportEndStarted = () => {};
    const endStarted = new Promise<void>(resolve => {
      reportEndStarted = resolve;
    });
    const endReleased = new Promise<void>(resolve => {
      releaseEnd = resolve;
    });
    const lifecycle = createRequestLifecycle(
      async () => {
        events.push('end:start');
        reportEndStarted();
        await endReleased;
        events.push('end:done');
      },
      () => {},
    );

    const finishing = lifecycle.run();
    const repeated = lifecycle.run();
    await endStarted;
    expect(events).toEqual(['end:start']);

    releaseEnd();
    await Promise.all([finishing, repeated]);
    expect(events).toEqual(['end:start', 'end:done']);
  });

  it('reports completion failures through onError without replacing the response', async () => {
    const failure = new Error('completion failed');
    const onErrorCalls: unknown[][] = [];
    const lifecycle = createRequestLifecycle(
      () => {
        throw failure;
      },
      (...args: unknown[]) => {
        onErrorCalls.push(args);
      },
    );

    await expect(lifecycle.run()).resolves.toBeUndefined();
    await lifecycle.run();

    expect(onErrorCalls).toEqual([[failure, REQUEST_END_ERROR]]);
  });

  it('defers completion until a streamed body is fully consumed', async () => {
    const terminals: unknown[] = [];
    const lifecycle = createRequestLifecycle(
      terminal => {
        terminals.push(terminal);
      },
      () => {},
    );
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

    const response = await finishWithRequestLifecycle(lifecycle, () =>
      lifecycle.deferUntilBodyDone(new Response(body)),
    );
    expect(lifecycle.deferred).toBe(true);
    expect(terminals).toEqual([]);

    const reader = response.body!.getReader();
    const shell = await reader.read();
    expect(new TextDecoder().decode(shell.value)).toBe('<shell>');
    expect(terminals).toEqual([]);

    releaseTail();
    const tail = await reader.read();
    expect(new TextDecoder().decode(tail.value)).toBe('<tail>');
    expect((await reader.read()).done).toBe(true);
    await lifecycle.run();
    expect(terminals).toEqual([{ status: 'complete' }]);
  });

  it('reports a streamed body error exactly once', async () => {
    const failure = new Error('stream failed');
    const terminals: unknown[] = [];
    const lifecycle = createRequestLifecycle(
      terminal => {
        terminals.push(terminal);
      },
      () => {},
    );
    const response = lifecycle.deferUntilBodyDone(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.error(failure);
          },
        }),
      ),
    );

    await expect(response.text()).rejects.toBe(failure);
    await lifecycle.run();
    expect(terminals).toEqual([{ status: 'error', error: failure }]);
  });

  it('awaits source cancellation before reporting the original cancellation reason', async () => {
    const events: unknown[] = [];
    let releaseCancel = () => {};
    let reportCancelStarted = () => {};
    let reportReadStarted = () => {};
    const cancelStarted = new Promise<void>(resolve => {
      reportCancelStarted = resolve;
    });
    const readStarted = new Promise<void>(resolve => {
      reportReadStarted = resolve;
    });
    const cancelReleased = new Promise<void>(resolve => {
      releaseCancel = resolve;
    });
    const lifecycle = createRequestLifecycle(
      terminal => {
        events.push(terminal);
      },
      () => {},
    );
    const response = lifecycle.deferUntilBodyDone(
      new Response(
        new ReadableStream<Uint8Array>({
          pull() {
            reportReadStarted();
          },
          async cancel(reason) {
            events.push(['cancel:start', reason]);
            reportCancelStarted();
            await cancelReleased;
            events.push('cancel:done');
          },
        }),
      ),
    );
    const reason = { message: 'client disconnected' };

    const reader = response.body!.getReader();
    const reading = reader.read();
    await readStarted;
    const cancelling = reader.cancel(reason);
    await cancelStarted;
    await reading;
    expect(events).toEqual([['cancel:start', reason]]);
    releaseCancel();
    await cancelling;
    await lifecycle.run();

    expect(events).toEqual([
      ['cancel:start', reason],
      'cancel:done',
      { status: 'cancelled', reason },
    ]);
  });

  it('reports cancellation even when the source cancellation rejects', async () => {
    const failure = new Error('source cancellation failed');
    const terminals: unknown[] = [];
    const lifecycle = createRequestLifecycle(
      terminal => {
        terminals.push(terminal);
      },
      () => {},
    );
    const response = lifecycle.deferUntilBodyDone(
      new Response(
        new ReadableStream<Uint8Array>({
          cancel() {
            throw failure;
          },
        }),
      ),
    );

    await expect(
      response.body!.cancel('client disconnected'),
    ).resolves.toBeUndefined();
    await lifecycle.run();
    expect(terminals).toEqual([
      { status: 'cancelled', reason: 'client disconnected' },
    ]);
  });

  it('completes bodyless responses immediately', async () => {
    const terminals: unknown[] = [];
    const lifecycle = createRequestLifecycle(
      terminal => {
        terminals.push(terminal);
      },
      () => {},
    );
    const redirect = new Response(null, {
      status: 302,
      headers: { Location: '/login' },
    });

    const response = await finishWithRequestLifecycle(lifecycle, () =>
      lifecycle.deferUntilBodyDone(redirect),
    );

    expect(response).toBe(redirect);
    expect(lifecycle.deferred).toBe(false);
    expect(terminals).toEqual([{ status: 'complete' }]);
  });

  it('reports a discarded bodyless response exactly once', async () => {
    const terminals: unknown[] = [];
    const lifecycle = createRequestLifecycle(
      terminal => {
        terminals.push(terminal);
      },
      () => {},
    );

    await lifecycle.discardBody(new Response(null, { status: 204 }));
    await lifecycle.run();

    expect(terminals).toEqual([{ status: 'discarded' }]);
  });

  it('finishes a discarded stream even when its cancellation rejects', async () => {
    const failure = new Error('source cancellation failed');
    const terminals: unknown[] = [];
    const lifecycle = createRequestLifecycle(
      terminal => {
        terminals.push(terminal);
      },
      () => {},
    );
    const response = new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          throw failure;
        },
      }),
    );

    await expect(lifecycle.discardBody(response)).rejects.toBe(failure);
    expect(lifecycle.deferred).toBe(true);
    expect(terminals).toEqual([{ status: 'error', error: failure }]);
    const reader = response.body!.getReader();
    await expect(reader.read()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    reader.releaseLock();

    await lifecycle.run();
    expect(terminals).toEqual([{ status: 'error', error: failure }]);
  });

  it('does not finish a stream while another reader still owns its body', async () => {
    const events: unknown[] = [];
    const lifecycle = createRequestLifecycle(
      terminal => {
        events.push(terminal);
      },
      () => {},
    );
    const original = new Response(
      new ReadableStream<Uint8Array>({
        cancel(reason) {
          events.push(reason);
        },
      }),
    );
    const owner = original.body!.getReader();

    await expect(
      finishWithRequestLifecycle(lifecycle, () =>
        lifecycle.deferUntilBodyDone(original),
      ),
    ).rejects.toThrow(
      'Cannot observe a locked response body before request completion',
    );
    expect(lifecycle.deferred).toBe(true);
    expect(events).toEqual([]);
    expect(original.body!.locked).toBe(true);

    await owner.cancel('owner finished');
    owner.releaseLock();
    await lifecycle.run();

    expect(events).toEqual(['owner finished', { status: 'complete' }]);
  });

  it('preserves finalization failures and reports their terminal state once', async () => {
    const failure = new Error('finalization failed');
    const terminals: unknown[] = [];
    const lifecycle = createRequestLifecycle(
      terminal => {
        terminals.push(terminal);
      },
      () => {},
    );

    await expect(
      finishWithRequestLifecycle(lifecycle, () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    await lifecycle.run();

    expect(terminals).toEqual([{ status: 'error', error: failure }]);
  });

  it('reports preparation errors while preserving the original failure', async () => {
    const failure = new Error('preparation failed');
    const terminals: unknown[] = [];
    const lifecycle = createRequestLifecycle(
      terminal => {
        terminals.push(terminal);
      },
      () => {},
    );

    await expect(
      runWithRequestLifecycleOnError(lifecycle, () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    await lifecycle.run();

    expect(terminals).toEqual([{ status: 'error', error: failure }]);
  });
});
