import {
  ActionForm,
  useLoaderData,
  useRouteAction,
} from '@modern-js/renderer-solid/router';
import type { JSX } from '@solidjs/web';
import { Loading, lazy } from 'solid-js';
import Counter from '../components/Counter';
import Deferred from '../components/Deferred';
import Message from '../components/Message';

const Lazy = lazy(() => import('../components/Lazy'));

export default function Home(): JSX.Element {
  const data = useLoaderData({ strict: false });
  const action = useRouteAction();
  return (
    <section data-testid="native-route" data-renderer="solid">
      <h1>Solid renderer fixture</h1>
      <Counter />
      <Message />
      <Deferred />
      <Loading fallback={<p data-testid="native-lazy-pending">Waiting lazy</p>}>
        <Lazy />
      </Loading>
      <pre data-testid="native-loader-value">{JSON.stringify(data())}</pre>
      <ActionForm action={action}>
        <label>
          Name <input name="name" />
        </label>
        <button
          type="submit"
          data-testid="native-submit"
          disabled={action.pending()}
        >
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
      </ActionForm>
      <pre data-testid="native-action-value">
        {JSON.stringify(action.outcome())}
      </pre>
      <output data-testid="native-action-error">
        {action.error()?.message}
      </output>
    </section>
  );
}
