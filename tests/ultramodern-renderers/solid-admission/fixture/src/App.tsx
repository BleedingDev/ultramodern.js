import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
} from '@modern-js/renderer-solid/router';
import { Loading, lazy } from 'solid-js';
import Counter from './Counter';
import Stable from './Stable';

const Lazy = lazy(() => import('./Lazy'));
const rootRoute = createRootRoute({
  component: () => (
    <>
      <h1>Solid admission</h1>
      <Link to="/second">Second page</Link>
      <Outlet />
    </>
  ),
});
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  loader: () => {
    globalThis.__loaderCalls = (globalThis.__loaderCalls ?? 0) + 1;
    return { message: 'loaded once' };
  },
  staleTime: Infinity,
  component: () => (
    <>
      <Counter />
      <Stable />
      <Loading fallback={<p>Waiting lazy</p>}>
        <Lazy />
      </Loading>
    </>
  ),
});
const secondRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/second',
  component: () => <p>Native navigation works</p>,
});
const routeTree = rootRoute.addChildren([indexRoute, secondRoute]);
export function createAppRouter(server = false, url = '/') {
  return createRouter({
    routeTree,
    history: server
      ? createMemoryHistory({ initialEntries: [url] })
      : undefined,
  });
}
export function App(props) {
  return <RouterProvider router={props.router} />;
}
