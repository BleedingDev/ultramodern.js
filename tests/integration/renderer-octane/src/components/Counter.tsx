import { useState } from 'octane';

/**
 * Hook state, not useSignal$: once a streamed-signal module has run,
 * @octanejs/rspack-plugin reloads the document on every hot update, so a
 * signal counter would reset on any edit.
 */
export default function Counter() {
  const [count, setCount] = useState(0);
  return (
    <section>
      <button
        type="button"
        data-testid="native-increment"
        onClick={() => setCount(value => value + 1)}
      >
        Increment
      </button>
      <output data-testid="native-count">{count}</output>
    </section>
  );
}
