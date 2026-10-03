import {
  Form,
  Link,
  RouteActionResponseError,
  useFetcher,
  useMatch,
} from '@bleedingdev/modern-js-plugin-tanstack/runtime';
import { Helmet } from '@bleedingdev/modern-js-runtime/head';
import { lazy, Suspense } from 'react';
import Counter from '../components/Counter';
import Deferred from '../components/Deferred';
import type { PageLoaderData } from './page.data';

const Lazy = lazy(() => import('../components/Lazy'));

function isPageLoaderData(value: unknown): value is PageLoaderData {
  return (
    value !== null &&
    typeof value === 'object' &&
    'message' in value &&
    typeof value.message === 'string' &&
    'privateValue' in value &&
    (value.privateValue === null || typeof value.privateValue === 'string') &&
    (!('late' in value) || value.late instanceof Promise)
  );
}

export default function Home() {
  const match = useMatch({ strict: false });
  const data: unknown = match.loaderData;
  const fetcher = useFetcher();
  const loaderFetcher = useFetcher();
  const FetcherForm = fetcher.Form;
  const LoaderFetcherForm = loaderFetcher.Form;
  const error = fetcher.error;
  const errorData =
    error instanceof RouteActionResponseError
      ? { status: error.response.status, data: error.data }
      : undefined;
  return (
    <section data-testid="native-route" data-renderer="react">
      <Helmet>
        <title>react acceptance home</title>
        <meta name="description" content="Native renderer conformance" />
      </Helmet>
      <h1>Hand-authored React consumer</h1>
      <Counter />
      {isPageLoaderData(data) ? <Deferred late={data.late} /> : null}
      <Suspense
        fallback={<p data-testid="native-lazy-pending">Waiting lazy</p>}
      >
        <Lazy />
      </Suspense>
      <pre data-testid="native-loader-value">{JSON.stringify(data)}</pre>
      <Form method="post" action="." data-testid="native-action-form">
        <label>
          Name <input name="name" />
        </label>
        <button type="submit" data-testid="native-form-submit">
          Save
        </button>
        <button type="submit" name="intent" value="redirect">
          Save and redirect
        </button>
        <button
          type="submit"
          name="intent"
          value="alternate"
          formAction="99?intent=alternate"
          data-testid="native-relative-submitter"
        >
          Save to relative target
        </button>
      </Form>
      <FetcherForm method="post" action="." data-testid="native-fetcher-form">
        <label>
          Fetcher name <input name="name" />
        </label>
        <button type="submit" data-testid="native-fetcher-submit">
          Save with native fetcher
        </button>
        <button type="submit" name="intent" value="redirect">
          Fetcher save and redirect
        </button>
      </FetcherForm>
      <LoaderFetcherForm
        method="get"
        action="."
        data-testid="native-loader-fetcher-form"
      >
        <button type="submit" data-testid="native-loader-fetcher-submit">
          Load with native fetcher
        </button>
      </LoaderFetcherForm>
      <pre data-testid="native-action-value">
        {JSON.stringify(fetcher.data)}
      </pre>
      <output data-testid="native-fetcher-state">{fetcher.state}</output>
      <pre data-testid="native-loader-fetcher-value">
        {JSON.stringify(loaderFetcher.data)}
      </pre>
      <output data-testid="native-loader-fetcher-state">
        {loaderFetcher.state}
      </output>
      <output data-testid="native-action-error">
        {error instanceof Response
          ? error.statusText || `Validation response ${error.status}`
          : error instanceof Error
            ? error.message
            : undefined}
      </output>
      <pre data-testid="native-action-error-data">
        {JSON.stringify(errorData)}
      </pre>
      <Link
        to="/"
        search={previous => ({ ...previous, case: 'deferred' })}
        preload={false}
        data-testid="native-deferred-link"
      >
        Open native deferred route
      </Link>
      <Link to="/about">Open native about route</Link>
    </section>
  );
}
