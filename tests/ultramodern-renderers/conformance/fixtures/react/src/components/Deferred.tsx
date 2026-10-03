import { Await } from '@bleedingdev/modern-js-plugin-tanstack/runtime';
import type { PageLoaderData } from '../routes/page.data';

export default function Deferred({ late }: { late: PageLoaderData['late'] }) {
  if (!late) return null;
  return (
    <Await
      promise={late}
      fallback={
        <span data-testid="native-deferred-pending">Native pending</span>
      }
    >
      {value => <output data-testid="native-deferred-late">{value}</output>}
    </Await>
  );
}
