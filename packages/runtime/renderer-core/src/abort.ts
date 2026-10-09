/**
 * Settle with the work, or reject once the signal aborts: work that ignores
 * cancellation must not keep its caller alive. A late Response body is
 * cancelled and a late failure observed.
 */
export function untilAborted<T>(
  handled: T | Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  const settled = Promise.resolve(handled);
  const discard = () =>
    void settled.then(
      value => {
        if (value instanceof Response)
          void value.body?.cancel().catch(() => {});
      },
      () => {},
    );
  if (signal.aborted) {
    discard();
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      discard();
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    settled.then(
      value => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      error => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}
