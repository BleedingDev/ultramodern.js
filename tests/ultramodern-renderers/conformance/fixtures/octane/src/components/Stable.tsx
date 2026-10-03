import { useEffect } from 'octane';
import { useSignal$ } from 'octane/signals/client';
import { observeResource } from '../conformance';

export default function Stable() {
  const count$ = useSignal$(0);
  const marker = 'Stable native resource';
  useEffect(() => observeResource('stable'), [marker]);
  return (
    <section data-testid="native-unaffected-component">
      <button type="button" onClick={() => count$.set(value => value + 1)}>
        Increment stable state
      </button>
      <output data-testid="native-unaffected-count">{count$.get()}</output>
    </section>
  );
}
