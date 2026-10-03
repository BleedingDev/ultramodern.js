import type { JSX } from '@solidjs/web';
import { createSignal, onCleanup } from 'solid-js';
import { observeResource } from '../conformance';

export default function Stable(): JSX.Element {
  const [count, setCount] = createSignal(0);
  onCleanup(observeResource('stable'));
  return (
    <section data-testid="native-unaffected-component">
      <button type="button" onClick={() => setCount(count() + 1)}>
        Increment stable state
      </button>
      <output data-testid="native-unaffected-count">{count()}</output>
    </section>
  );
}
