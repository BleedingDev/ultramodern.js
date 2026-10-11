import { createSignal, onCleanup } from 'solid-js';
export default function Stable() {
  const [value, setValue] = createSignal(0);
  onCleanup(
    () => (globalThis.__stableCleanup = (globalThis.__stableCleanup ?? 0) + 1),
  );
  return (
    <button id="stable-count" onClick={() => setValue(value() + 1)}>
      Stable {value()}
    </button>
  );
}
