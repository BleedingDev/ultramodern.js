import { useSignal$ } from 'octane/signals/client';

export default function Counter() {
  const count$ = useSignal$(0);
  return (
    <section>
      <button
        type="button"
        data-testid="native-increment"
        onClick={() => count$.set(value => value + 1)}
      >
        Increment
      </button>
      <output data-testid="native-count">{count$.get()}</output>
    </section>
  );
}
