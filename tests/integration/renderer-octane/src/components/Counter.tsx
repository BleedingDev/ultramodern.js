import { useEffect, useRef } from 'octane';
import { useSignal$ } from 'octane/signals/client';

export default function Counter() {
  const count$ = useSignal$(0);
  const button = useRef<HTMLButtonElement | null>(null);
  // Effects run only once the browser has hydrated the counter.
  useEffect(() => {
    button.current?.setAttribute('data-hydrated', '');
  }, []);
  return (
    <section>
      <button
        ref={button}
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
