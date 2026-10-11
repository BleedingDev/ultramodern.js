import { Await, useLoaderData } from '@modern-js/renderer-solid/router';
import type { JSX } from '@solidjs/web';

export default function Deferred(): JSX.Element {
  const data = useLoaderData({ strict: false });
  // Read the promise through a plain getter: a Solid memo (Show, for one)
  // would await it and hand Await the resolved value instead.
  const late = () => {
    const value: unknown = data();
    return typeof value === 'object' &&
      value !== null &&
      'late' in value &&
      value.late instanceof Promise
      ? (value.late as Promise<string>)
      : undefined;
  };
  return (
    <>
      {late() ? (
        <Await
          promise={late()!}
          fallback={
            <span data-testid="native-deferred-pending">Native pending</span>
          }
        >
          {value => (
            <output data-testid="native-deferred-late">{String(value)}</output>
          )}
        </Await>
      ) : null}
    </>
  );
}
