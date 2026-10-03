import { useEffect } from 'octane';
import { useSignal$ } from 'octane/signals/client';
import { observeResource } from '../conformance';

export default function Counter() {
  const count$ = useSignal$(0);
  const marker = 'Counter before native edit';
  useEffect(() => observeResource('counter'), [marker]);
  return (
    <section data-testid="native-edited-component">
      <span data-testid="native-hmr-marker">{marker}</span>
      <button type="button" onClick={() => count$.set(value => value + 1)}>
        Increment
      </button>
      <output data-testid="native-count">{count$.get()}</output>
    </section>
  );
}
