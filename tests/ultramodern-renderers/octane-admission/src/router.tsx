import {
  Body,
  createRootRoute,
  createRoute,
  createRouter,
  Head,
  HeadContent,
  Html,
  Link,
  Outlet,
  Scripts,
} from '@octanejs/tanstack-router';
import { Counter } from './Counter.tsrx';

function Root() {
  return (
    <Html lang="en">
      <Head>
        <HeadContent />
      </Head>
      <Body>
        <nav>
          <Link to="/">Home</Link>
          <Link to="/about">About</Link>
        </nav>
        <Counter />
        <Outlet />
        <Scripts />
        <script src="/router-client.js" defer />
      </Body>
    </Html>
  );
}

function Home() {
  const data = homeRoute.useLoaderData();
  return <h1 data-testid="route">{data.message}</h1>;
}

function About() {
  const data = aboutRoute.useLoaderData();
  return <h1 data-testid="route">{data.message}</h1>;
}

const rootRoute = createRootRoute({
  component: Root,
  head: () => ({ meta: [{ title: 'Native Octane router' }] }),
});
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Home,
  loader: () => ({ message: 'Native home loader' }),
});
const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/about',
  component: About,
  loader: () => ({ message: 'Native about loader' }),
});
const routeTree = rootRoute.addChildren([homeRoute, aboutRoute]);

export function getRouter() {
  return createRouter({ routeTree, defaultPreload: 'intent' });
}

declare module '@octanejs/tanstack-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
