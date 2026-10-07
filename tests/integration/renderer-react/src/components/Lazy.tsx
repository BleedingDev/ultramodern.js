import { useState } from 'react';
import './Lazy.css';

export default function Lazy() {
  const [count, setCount] = useState(0);
  return (
    <aside className="native-lazy-detail" data-testid="native-lazy">
      <span>Native lazy React value</span>
      <button
        type="button"
        data-testid="native-lazy-increment"
        onClick={() => setCount(value => value + 1)}
      >
        Increment lazy
      </button>
      <output data-testid="native-lazy-count">{count}</output>
    </aside>
  );
}
