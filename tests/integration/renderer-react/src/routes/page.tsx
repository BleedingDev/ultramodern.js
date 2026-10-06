import {
  RouteActionResponseError,
  useFetcher,
  useMatch,
} from '@modern-js/plugin-tanstack/runtime';
import { Helmet } from '@modern-js/runtime/head';
import { lazy, Suspense } from 'react';
import Counter from '../components/Counter';
import Deferred from '../components/Deferred';
import type { PageLoaderData } from './page.data';

const Lazy = lazy(() => import('../components/Lazy'));

export default function Home() {
  const data = useMatch({ strict: false }).loaderData as
    | PageLoaderData
    | undefined;
  const fetcher = useFetcher();
  const FetcherForm = fetcher.Form;
  const error = fetcher.error;
  return (
    <section data-testid="native-route" data-renderer="react">
      <Helmet>
        <title>react fixture home</title>
        <meta name="description" content="Renderer fixture" />
      </Helmet>
      <h1>React renderer fixture</h1>
      <Counter />
      <Deferred late={data?.late} />
      <Suspense
        fallback={<p data-testid="native-lazy-pending">Waiting lazy</p>}
      >
        <Lazy />
      </Suspense>
      <pre data-testid="native-loader-value">{JSON.stringify(data)}</pre>
      <FetcherForm method="post" action=".">
        <label>
          Name <input name="name" />
        </label>
        <button type="submit" data-testid="native-submit">
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
      </FetcherForm>
      <pre data-testid="native-action-value">
        {JSON.stringify(fetcher.data)}
      </pre>
      <output data-testid="native-action-error">
        {error instanceof Response
          ? `Validation response ${error.status}`
          : error instanceof RouteActionResponseError
            ? `${error.response.status} ${JSON.stringify(error.data)}`
            : error instanceof Error
              ? error.message
              : undefined}
      </output>
    </section>
  );
}
