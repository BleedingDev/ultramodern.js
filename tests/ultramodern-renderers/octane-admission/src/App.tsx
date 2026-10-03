import { lazy, Suspense, use } from 'octane';
import { Counter } from './Counter.tsrx';

const LazyPanel = lazy(() =>
  import('./Lazy').then(module => ({ default: module.LazyPanel })),
);

function DeferredValue({ value }: { value: Promise<string> }) {
  return <p data-testid="deferred">{use(value)}</p>;
}

export function App({ deferred }: { deferred?: Promise<string> }) {
  return (
    <main>
      <title>Octane admission</title>
      <meta name="renderer" content="octane" />
      <h1 data-testid="title">Released Octane</h1>
      <Counter />
      <Suspense
        fallback={<p data-testid="lazy-fallback">Loading native module</p>}
      >
        <LazyPanel />
      </Suspense>
      {deferred && (
        <Suspense
          fallback={<p data-testid="deferred-fallback">Loading native data</p>}
        >
          <DeferredValue value={deferred} />
        </Suspense>
      )}
    </main>
  );
}
