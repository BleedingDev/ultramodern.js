import { useLoaderData } from '@octanejs/tanstack-router';
import { useEffect, useState } from 'octane';

export function Leaf() {
  const data = useLoaderData({ strict: false }) as { label: string };
  const [count, setCount] = useState(0);
  useEffect(() => {
    const lifecycle = (globalThis.fragmentLifecycle ??= {
      leaf: { mounts: 0, cleanups: 0 },
      sibling: { mounts: 0, cleanups: 0 },
    }).leaf;
    lifecycle.mounts++;
    return () => {
      lifecycle.cleanups++;
    };
  }, []);
  return (
    <section data-testid="leaf">
      <h2>{data.label}</h2>
      <button data-testid="leaf-count" onClick={() => setCount(count + 1)}>
        {`Leaf count: ${count}`}
      </button>
    </section>
  );
}
