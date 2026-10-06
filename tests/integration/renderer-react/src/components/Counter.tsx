import { useState } from 'react';

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
