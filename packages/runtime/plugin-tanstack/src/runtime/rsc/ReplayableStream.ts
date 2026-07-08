// @effect-diagnostics asyncFunction:off newPromise:off strictBooleanExpressions:off
interface ReplayableStreamOptions {
  signal?: AbortSignal;
}

type Waiter = {
  promise: Promise<void>;
  resolve: () => void;
};

const REPLAYABLE_STREAM_MARKER = Symbol.for(
  'modern.tanstack.rsc.ReplayableStream',
);

export class ReplayableStream<T = Uint8Array> {
  readonly [REPLAYABLE_STREAM_MARKER] = true;

  private chunks: T[] = [];
  private done = false;
  private error: unknown;
  private waiter: Waiter | null = null;
  private released = false;
  private reader: ReadableStreamDefaultReader<T> | null = null;
  private abortListener: (() => void) | null = null;

  constructor(
    private source: ReadableStream<T>,
    private options: ReplayableStreamOptions = {},
  ) {
    this.start();
  }

  private start() {
    const signal = this.options.signal;
    if (signal?.aborted) {
      this.release();
      return;
    }

    this.abortListener = () => this.release();
    signal?.addEventListener('abort', this.abortListener, { once: true });

    const reader = this.source.getReader();
    this.reader = reader;

    const pump = async () => {
      try {
        while (!this.released) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          this.chunks.push(value);
          this.notify();
        }
      } catch (err) {
        if (!this.released) {
          this.error = err;
        }
      } finally {
        this.done = true;
        this.detachAbortListener();
        try {
          reader.releaseLock();
        } catch {}
        if (this.reader === reader) {
          this.reader = null;
        }
        this.notify();
      }
    };

    void pump();
  }

  private detachAbortListener() {
    const signal = this.options.signal;
    if (signal && this.abortListener) {
      signal.removeEventListener('abort', this.abortListener);
    }
    this.abortListener = null;
  }

  private notify() {
    this.waiter?.resolve();
    this.waiter = null;
  }

  private wait() {
    if (this.done || this.released) {
      return Promise.resolve();
    }
    if (!this.waiter) {
      let resolve!: () => void;
      const promise = new Promise<void>(res => {
        resolve = res;
      });
      this.waiter = { promise, resolve };
    }
    return this.waiter.promise;
  }

  release() {
    if (this.released) {
      return;
    }
    this.released = true;
    this.chunks = [];
    this.detachAbortListener();
    try {
      void this.reader?.cancel(new Error('ReplayableStream released'));
    } catch {}
    this.notify();
  }

  isReleased() {
    return this.released;
  }

  createReplayStream(): ReadableStream<T> {
    if (this.released) {
      return new ReadableStream<T>({
        start(controller) {
          controller.close();
        },
      });
    }

    let index = 0;
    return new ReadableStream<T>({
      pull: async controller => {
        while (true) {
          if (index < this.chunks.length) {
            controller.enqueue(this.chunks[index++]);
            return;
          }

          if (this.error) {
            controller.error(this.error);
            return;
          }

          if (this.done || this.released) {
            controller.close();
            return;
          }

          await this.wait();
        }
      },
      cancel: () => {
        // Canceling one replay reader must not cancel the shared upstream stream.
      },
    });
  }
}
