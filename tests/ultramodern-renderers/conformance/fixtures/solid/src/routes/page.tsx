import {
  ActionForm,
  Link,
  useLoaderData,
  useRouteAction,
} from '@bleedingdev/modern-js-renderer-solid/router';
import type { JSX } from '@solidjs/web';
import { Loading, lazy } from 'solid-js';
import Counter from '../components/Counter';
import Deferred from '../components/Deferred';

const Lazy = lazy(() => import('../components/Lazy'));

export default function Home(): JSX.Element {
  const data = useLoaderData({ strict: false });
  const action = useRouteAction();
  return (
    <section data-testid="native-route" data-renderer="solid">
      <h1>Hand-authored Solid consumer</h1>
      <Counter />
      <Deferred />
      <Loading fallback={<p data-testid="native-lazy-pending">Waiting lazy</p>}>
        <Lazy />
      </Loading>
      <pre data-testid="native-loader-value">{JSON.stringify(data())}</pre>
      <ActionForm action={action}>
        <label>
          Name <input name="name" />
        </label>
        <button type="submit" disabled={action.pending()}>
          Save
        </button>
        <button type="submit" name="intent" value="redirect">
          Save and redirect
        </button>
        <button
          type="submit"
          name="intent"
          value="alternate"
          formaction="99?intent=alternate"
          data-testid="native-relative-submitter"
        >
          Save to relative target
        </button>
      </ActionForm>
      <pre data-testid="native-action-value">
        {JSON.stringify(action.outcome())}
      </pre>
      <output data-testid="native-action-error">
        {action.error()?.message}
      </output>
      <Link
        to="/"
        search={(previous: Record<string, unknown>) => ({
          ...previous,
          case: 'deferred',
        })}
        preload={false}
        data-testid="native-deferred-link"
      >
        Open native deferred route
      </Link>
      <Link to="/about">Open native about route</Link>
      <Link to="/items/99" data-testid="native-item-link">
        Open native item route
      </Link>
    </section>
  );
}
