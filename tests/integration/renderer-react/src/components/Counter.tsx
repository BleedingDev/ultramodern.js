import { useEffect, useRef, useState } from 'react';

export default function Counter() {
  const [count, setCount] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
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
        onClick={() => setCount(value => value + 1)}
      >
        Increment
      </button>
      <output data-testid="native-count">{count}</output>
    </section>
  );
}
