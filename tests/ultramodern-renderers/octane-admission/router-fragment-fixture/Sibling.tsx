import { useEffect, useState } from 'octane';

declare global {
  var fragmentLifecycle:
    | {
        leaf: { mounts: number; cleanups: number };
        sibling: { mounts: number; cleanups: number };
      }
    | undefined;
}

export function Sibling() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const lifecycle = (globalThis.fragmentLifecycle ??= {
      leaf: { mounts: 0, cleanups: 0 },
      sibling: { mounts: 0, cleanups: 0 },
    }).sibling;
    lifecycle.mounts++;
    return () => {
      lifecycle.cleanups++;
    };
  }, []);
  return (
    <button data-testid="sibling" onClick={() => setCount(count + 1)}>
      {`Sibling count: ${count}`}
    </button>
  );
}
