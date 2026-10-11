import { createSignal, onCleanup } from 'solid-js';
export default function Lazy() {
  const [n, setN] = createSignal(0);
  onCleanup(
    () => (globalThis.__lazyCleanup = (globalThis.__lazyCleanup ?? 0) + 1),
  );
  return (
    <button id="lazy-count" onClick={() => setN(n() + 1)}>
      Lazy {n()}
    </button>
  );
}
