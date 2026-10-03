import { useLayoutEffect, useState } from 'octane';
import { signal$ } from 'octane/signals';

export function ClientApplication({
  label,
  onCleanup,
  shouldFail,
  onRender,
}: {
  label: string;
  onCleanup?: () => void;
  shouldFail?: boolean;
  onRender?: () => void;
}) {
  onRender?.();
  if (shouldFail) throw new Error('Native scheduled render failed');
  const [count, setCount] = useState(0);
  useLayoutEffect(() => () => onCleanup?.(), []);
  return (
    <section data-fixture="native-client">
      <p>{label}</p>
      <button onClick={() => setCount(count + 1)}>{`Count: ${count}`}</button>
    </section>
  );
}

export function HydrationApplication() {
  return <section data-fixture="native-hydration">Native hydration</section>;
}

export function ThrowingApplication() {
  throw new Error('Native component failed');
}

// The native bridge must install the server value before an application import
// reads this descriptor. The authored key is the public transport identity.
export const initialSignal$ = signal$(0, { key: 'renderer-client-seed' });
