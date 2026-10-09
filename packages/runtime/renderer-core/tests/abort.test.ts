import { describe, expect, it, rstest } from '@rstest/core';
import { untilAborted } from '../src/abort';

describe('untilAborted', () => {
  it('settles with the work while the signal stays open', async () => {
    const controller = new AbortController();
    await expect(
      untilAborted(Promise.resolve('done'), controller.signal),
    ).resolves.toBe('done');
    await expect(
      untilAborted(Promise.reject(new Error('failed')), controller.signal),
    ).rejects.toThrow('failed');
  });

  it('rejects on abort although the work never settles', async () => {
    const controller = new AbortController();
    const waiting = untilAborted(new Promise(() => {}), controller.signal);
    controller.abort(new Error('released'));
    await expect(waiting).rejects.toThrow('released');
    const aborted = new AbortController();
    aborted.abort(new Error('already'));
    await expect(
      untilAborted(new Promise(() => {}), aborted.signal),
    ).rejects.toThrow('already');
  });

  it('observes a late rejection and cancels a late response body', async () => {
    const unhandled = rstest.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const failing = new AbortController();
      let fail!: (error: Error) => void;
      const waiting = untilAborted(
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
        failing.signal,
      );
      failing.abort(new Error('released'));
      await expect(waiting).rejects.toThrow('released');
      fail(new Error('late'));

      const responding = new AbortController();
      let respond!: (response: Response) => void;
      const response = untilAborted(
        new Promise<Response>(resolve => {
          respond = resolve;
        }),
        responding.signal,
      );
      responding.abort(new Error('released'));
      await expect(response).rejects.toThrow('released');
      const cancel = rstest.fn();
      respond(new Response(new ReadableStream({ cancel })));
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
