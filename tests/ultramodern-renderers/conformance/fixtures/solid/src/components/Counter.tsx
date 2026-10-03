import type { JSX } from '@solidjs/web';
import { createSignal, onCleanup } from 'solid-js';
import { observeResource } from '../conformance';

export default function Counter(): JSX.Element {
  const [count, setCount] = createSignal(0);
  onCleanup(observeResource('counter'));
  return (
    <section data-testid="native-edited-component">
      <span data-testid="native-hmr-marker">Counter before native edit</span>
      <button type="button" onClick={() => setCount(count() + 1)}>
        Increment
      </button>
      <output data-testid="native-count">{count()}</output>
    </section>
  );
}
