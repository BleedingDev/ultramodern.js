import {
  createOctaneRouteAction,
  useApplicationIdentity,
  useApplicationRouteId,
  useLoaderData,
  useRouter,
} from '@modern-js/renderer-octane/router';
import { useActionState, useMemo } from 'octane';
import Counter from '../components/Counter';
import Deferred from '../components/Deferred';

export default function Home() {
  const router = useRouter();
  const identity = useApplicationIdentity();
  const routeId = useApplicationRouteId();
  const data = useLoaderData({ strict: false });
  const submit = useMemo(
    () => createOctaneRouteAction({ router, routeId, identity }),
    [router, routeId, identity],
  );
  const [result, action, pending] = useActionState(submit, undefined);
  return (
    <section data-testid="native-route" data-renderer="octane">
      <h1>Octane renderer fixture</h1>
      <Counter />
      <Deferred />
      <pre data-testid="native-loader-value">{JSON.stringify(data)}</pre>
      <form action={action}>
        <label>
          Name <input name="name" />
        </label>
        <button type="submit" data-testid="native-submit" disabled={pending}>
          Save
        </button>
        <button
          type="submit"
          name="intent"
          value="redirect"
          data-testid="native-submit-redirect"
        >
          Save and redirect
        </button>
      </form>
      <pre data-testid="native-action-value">{JSON.stringify(result)}</pre>
    </section>
  );
}
