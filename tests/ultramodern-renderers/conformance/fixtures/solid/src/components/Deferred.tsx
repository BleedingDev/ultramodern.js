import {
  Await,
  useLoaderData,
} from '@bleedingdev/modern-js-renderer-solid/router';
import type { JSX } from '@solidjs/web';
import { Show } from 'solid-js';

export default function Deferred(): JSX.Element {
  const data = useLoaderData({ strict: false });
  const late = () => {
    const value: unknown = data();
    return typeof value === 'object' &&
      value !== null &&
      'late' in value &&
      value.late instanceof Promise
      ? value.late
      : undefined;
  };
  return (
    <Show when={late()}>
      {promise => (
        <Await
          promise={promise()}
          fallback={
            <span data-testid="native-deferred-pending">Native pending</span>
          }
        >
          {value => (
            <output data-testid="native-deferred-late">{String(value)}</output>
          )}
        </Await>
      )}
    </Show>
  );
}
