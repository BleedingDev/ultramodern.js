import { createSignal, onCleanup } from 'solid-js';
export default function Counter() {
  const [count, setCount] = createSignal<number>(0);
  onCleanup(
    () => (globalThis.__solidCleanup = (globalThis.__solidCleanup ?? 0) + 1),
  );
  return <button onClick={() => setCount(count() + 1)}>Count {count()}</button>;
}
