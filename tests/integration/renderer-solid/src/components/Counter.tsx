import type { JSX } from '@solidjs/web';
import { createSignal } from 'solid-js';

export default function Counter(): JSX.Element {
  const [count, setCount] = createSignal(0);
  return (
    <section>
      <button
        type="button"
        data-testid="native-increment"
        onClick={() => setCount(count() + 1)}
      >
        Increment
      </button>
      <output data-testid="native-count">{count()}</output>
    </section>
  );
}
