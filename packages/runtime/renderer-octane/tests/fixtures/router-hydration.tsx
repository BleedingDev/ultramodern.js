import type {
  DataOutcome,
  FileSystemRouteIR,
} from '@modern-js/renderer-core/data';
import { Link, Outlet, useLoaderData } from '@octanejs/tanstack-router';
import { useState } from 'octane';
import { createFileSystemRouteTree } from '../../src/routes';

export const routerHydrationIdentity = {
  renderer: 'octane',
  appId: 'native-router-hydration',
  entryName: 'main',
  protocolVersion: 1,
  buildId: 'native-router-hydration-source',
} as const;

export const routerHydrationHead = {
  title: 'Native Octane route hydration',
  description: 'Native route metadata survives hydration and navigation',
  canonical: 'https://native.test/native-router-hydration',
} as const;

export interface RouterHydrationLoadCall {
  routeId: string;
  pathname: string;
  productId?: string;
}

function ApplicationRoot() {
  const [count, setCount] = useState(0);
  return (
    <main data-fixture="native-router-hydration">
      <h1>Native Octane routes</h1>
      <button
        onClick={() => setCount(count + 1)}
      >{`Root count: ${count}`}</button>
      <nav>
        <Link to="/" data-fixture="home-link">
          Home
        </Link>
        <Link
          to="/products/$productId"
          params={{ productId: '42' }}
          data-fixture="product-link"
        >
          Product 42
        </Link>
      </nav>
      <Outlet />
    </main>
  );
}

function Home() {
  const data = useLoaderData({ strict: false }) as { label: string };
  return (
    <section data-fixture="home-route">
      <h2>{data.label}</h2>
    </section>
  );
}

function Product() {
  const data = useLoaderData({ strict: false }) as { label: string };
  return (
    <section data-fixture="product-route">
      <h2>{data.label}</h2>
    </section>
  );
}

const routes: FileSystemRouteIR[] = [
  {
    id: 'application',
    isRoot: true,
    modules: { data: '/application.data.ts' },
    children: [
      {
        id: 'home',
        index: true,
        modules: { data: '/home.data.ts' },
        children: [],
      },
      {
        id: 'product',
        path: 'products/:productId',
        modules: { data: '/product.data.ts' },
        children: [],
      },
    ],
  },
];

export function createHydrationRouteTree(
  environment: 'server' | 'client',
  calls: RouterHydrationLoadCall[],
  request?: Request,
) {
  return createFileSystemRouteTree(
    routes,
    {
      application: {
        component: ApplicationRoot,
        head: () => ({
          meta: [
            { title: routerHydrationHead.title },
            { name: 'description', content: routerHydrationHead.description },
          ],
          links: [{ rel: 'canonical', href: routerHydrationHead.canonical }],
        }),
      },
      home: { component: Home },
      product: { component: Product },
    },
    {
      request,
      loadRoute: async (route, input): Promise<DataOutcome> => {
        calls.push({
          routeId: route.id,
          pathname: new URL(input.request.url).pathname,
          ...(input.params.productId
            ? { productId: input.params.productId }
            : {}),
        });
        return {
          kind: 'success',
          value: {
            label:
              route.id === 'product'
                ? `Product ${input.params.productId} ${environment} data`
                : `${route.id} ${environment} data`,
          },
          response: {
            status: 200,
            statusText: '',
            headers: [],
            cachePolicy: 'no-store',
          },
        };
      },
    },
  );
}
