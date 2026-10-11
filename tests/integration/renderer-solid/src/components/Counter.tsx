import type { JSX } from '@solidjs/web';
import { createSignal, onSettled } from 'solid-js';

export default function Counter(): JSX.Element {
  const [count, setCount] = createSignal(0);
  let button!: HTMLButtonElement;
  // Settled callbacks run only once the browser has hydrated the counter.
  onSettled(() => {
    button.setAttribute('data-hydrated', '');
  });
  return (
    <section>
      <button
        ref={button}
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
