import { Link, Outlet, useLoaderData } from '@octanejs/tanstack-router';
import { useState } from 'octane';
import { createFileSystemRouteTree } from './framework-routes';
import { Leaf } from './Leaf';
import { Sibling } from './Sibling';

export const identity = {
  renderer: 'octane',
  appId: 'native-public-fragment-admission',
  entryName: 'main',
  protocolVersion: 1,
  buildId: 'owning-source-fragment-pair',
} as const;

function Root() {
  const [count, setCount] = useState(0);
  return (
    <main data-testid="fragment-root">
      <h1>Native public router fragment</h1>
      <button data-testid="root-count" onClick={() => setCount(count + 1)}>
        {`Root count: ${count}`}
      </button>
      <Sibling />
      <nav>
        <Link to="/" data-testid="home-link">
          Home
        </Link>
        <Link
          to="/products/$productId"
          params={{ productId: '42' }}
          data-testid="product-link"
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
  return <h2 data-testid="home">{data.label}</h2>;
}

export function routeTree(
  environment: 'server' | 'client',
  calls: string[],
  request?: Request,
) {
  return createFileSystemRouteTree(
    [
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
    ],
    {
      application: {
        component: Root,
        head: () => ({ meta: [{ title: 'Native public fragment admission' }] }),
      },
      home: { component: Home },
      product: { component: Leaf },
    },
    {
      ...(request === undefined ? {} : { request }),
      loadRoute: async (route, input) => {
        calls.push(route.id);
        const { productId } = input.params;
        return {
          kind: 'success',
          value: {
            label:
              route.id === 'product'
                ? `Product ${productId} ${environment} data`
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
