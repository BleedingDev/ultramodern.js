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

  const maybeRstest = (
    globalThis as {
      rstest?: {
        setTimeout?: (timeout: number) => void;
        setConfig?: (config: {
          testTimeout?: number;
          hookTimeout?: number;
        }) => void;
      };
    }
  ).rstest;
  if (maybeRstest?.setTimeout) {
    maybeRstest.setTimeout(timeoutMs);
  }
  maybeRstest?.setConfig?.({
    testTimeout: timeoutMs,
    hookTimeout: timeoutMs,
  });
}
