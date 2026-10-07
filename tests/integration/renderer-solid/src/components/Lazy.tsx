import type { JSX } from '@solidjs/web';
import { createSignal } from 'solid-js';
import './Lazy.css';

export default function Lazy(): JSX.Element {
  const [count, setCount] = createSignal(0);
  return (
    <aside class="native-lazy-detail" data-testid="native-lazy">
      <span>Native lazy component</span>
      <button
        type="button"
        data-testid="native-lazy-increment"
        onClick={() => setCount(count() + 1)}
      >
        Increment lazy
      </button>
      <output data-testid="native-lazy-count">{count()}</output>
    </aside>
  );
}
