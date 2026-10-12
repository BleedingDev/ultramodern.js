import { useEffect, useRef, useState } from 'octane';
import './Lazy.css';

export default function Lazy() {
  const [count, setCount] = useState(0);
  const button = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    button.current?.setAttribute('data-hydrated', '');
  }, []);
  return (
    <aside class="native-lazy-detail" data-testid="native-lazy">
      <span>Native lazy Octane value</span>
      <button
        ref={button}
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
