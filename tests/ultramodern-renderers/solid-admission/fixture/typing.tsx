import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
} from '@modern-js/renderer-solid/router';
import { hydrate, render } from '@solidjs/web';
import { createSignal } from 'solid-js';

function Counter() {
  const [count, setCount] = createSignal(0);
  return <button onClick={() => setCount(count() + 1)}>{count()}</button>;
}

const root = createRootRoute({ component: () => <Outlet /> });
const index = createRoute({
  getParentRoute: () => root,
  path: '/',
  component: Counter,
});
const router = createRouter({ routeTree: root.addChildren([index]) });
const view = () => (
  <>
    <Link to="/">Home</Link>
    <RouterProvider router={router} />
  </>
);
const element = document.createElement('div');
const disposeRender: () => void = render(view, element);
const disposeHydrate: () => void = hydrate(view, element, {
  renderId: 'typed',
});
disposeRender();
disposeHydrate();
