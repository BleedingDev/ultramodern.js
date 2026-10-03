import {
  Await,
  useLoaderData,
} from '@bleedingdev/modern-js-renderer-octane/router';

export default function Deferred() {
  const data: unknown = useLoaderData({ strict: false });
  const late =
    typeof data === 'object' &&
    data !== null &&
    'late' in data &&
    data.late instanceof Promise
      ? data.late
      : undefined;
  return late ? (
    <Await
      promise={late}
      fallback={
        <span data-testid="native-deferred-pending">Native pending</span>
      }
    >
      {value => (
        <output data-testid="native-deferred-late">{String(value)}</output>
      )}
    </Await>
  ) : null;
}
