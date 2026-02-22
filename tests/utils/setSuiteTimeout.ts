export function setSuiteTimeout(timeoutMs: number) {
  const maybeJest = (
    globalThis as {
      jest?: {
        setTimeout?: (timeout: number) => void;
      };
    }
  ).jest;
  if (maybeJest?.setTimeout) {
    maybeJest.setTimeout(timeoutMs);
  }

  const maybeVi = (
    globalThis as {
      vi?: {
        setConfig?: (config: {
          testTimeout?: number;
          hookTimeout?: number;
        }) => void;
      };
    }
  ).vi;
  maybeVi?.setConfig?.({
    testTimeout: timeoutMs,
    hookTimeout: timeoutMs,
  });
}
