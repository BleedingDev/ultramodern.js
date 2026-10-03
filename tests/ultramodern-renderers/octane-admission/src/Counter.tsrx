import { useAdmissionCount } from "./plain";
import { useEffect } from "octane";

declare global {
  var admissionCounterLifecycle: { mounts: number; cleanups: number } | undefined;
}

export function Counter() @{
  const [count, setCount] = useAdmissionCount();
  useEffect(() => {
    const lifecycle = (globalThis.admissionCounterLifecycle ??= { mounts: 0, cleanups: 0 });
    lifecycle.mounts++;
    return () => {
      lifecycle.cleanups++;
    };
  }, []);
  <button data-testid="counter" onClick={() => setCount(count + 1)}>
    {"Count: " + count}
  </button>;
}
