import { useEffect, useState } from 'react';
import { observeResource } from '../conformance';

export default function Stable() {
  const [count, setCount] = useState(0);
  useEffect(() => observeResource('stable'), []);
  return (
    <section data-testid="native-unaffected-component">
      <button type="button" onClick={() => setCount(value => value + 1)}>
        Increment stable state
      </button>
      <output data-testid="native-unaffected-count">{count}</output>
    </section>
  );
}
