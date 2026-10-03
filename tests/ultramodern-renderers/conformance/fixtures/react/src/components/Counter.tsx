import { useEffect, useState } from 'react';
import { observeResource } from '../conformance';

export default function Counter() {
  const [count, setCount] = useState(0);
  useEffect(() => observeResource('counter'), []);
  return (
    <section data-testid="native-edited-component">
      <span data-testid="native-hmr-marker">Counter before native edit</span>
      <button type="button" onClick={() => setCount(value => value + 1)}>
        Increment
      </button>
      <output data-testid="native-count">{count}</output>
    </section>
  );
}
