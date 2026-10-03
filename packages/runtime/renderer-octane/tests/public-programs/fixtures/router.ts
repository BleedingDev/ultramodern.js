import {
  type AnyRouter,
  ApplicationRouter,
  createApplicationRouter,
  createFileSystemRouteTree,
  createOctaneRouteAction,
  type ErrorRouteComponent,
  type FileSystemDataModule,
  type FileSystemRouteModule,
  type FileSystemRouteOptions,
  Link,
  type LinkComponentProps,
  type NotFoundRouteComponent,
  type OctaneRouteActionOptions,
  Outlet,
  type RouteComponent,
  RouteDataError,
  resolveRouteData,
  selectApplicationDataRoute,
} from '@bleedingdev/modern-js-renderer-octane/router';
import { createElement, useActionState } from 'octane';
import type { Octane } from 'octane/jsx-runtime';

interface RouteContext {
  label: string;
}

export function routerPublicProgram(
  request: Request,
  identity: OctaneRouteActionOptions['identity'],
) {
  const Page: RouteComponent = _props => null;
  const ErrorPage: ErrorRouteComponent = _props => null;
  const MissingPage: NotFoundRouteComponent = _props => null;
  const NativeOutlet: RouteComponent = Outlet;
  const routes: Parameters<typeof createFileSystemRouteTree>[0] = [
    {
      id: 'root',
      isRoot: true,
      children: [{ id: 'home', index: true, children: [] }],
    },
  ];
  const modules: Readonly<Record<string, FileSystemRouteModule>> = {
    root: { component: NativeOutlet },
    home: {
      component: Page,
      pendingComponent: Page,
      errorComponent: ErrorPage,
      notFoundComponent: MissingPage,
      head: () => ({ meta: [{ title: 'Native public router' }] }),
    },
  };
  const context: RouteContext = { label: 'Native route data' };
  const options: FileSystemRouteOptions<RouteContext> = {
    request,
    context,
    loadRoute: async (route, input) => ({
      kind: 'success',
      value: { routeId: route.id, label: input.context.label },
      response: {
        status: 200,
        statusText: 'OK',
        headers: [],
        cachePolicy: 'no-store',
      },
    }),
  };
  const routeTree = createFileSystemRouteTree(routes, modules, options);
  const router: AnyRouter = createApplicationRouter({
    routeTree,
    context: { ultramodern: { rendererIdentity: identity } },
  });
  const actionOptions: OctaneRouteActionOptions = {
    router,
    routeId: 'home',
    identity,
    method: 'POST',
    url: () => request.url,
    signal: request.signal,
  };
  const action: ReturnType<typeof createOctaneRouteAction> =
    createOctaneRouteAction(actionOptions);
  const [state, submit, pending] = useActionState<
    Awaited<ReturnType<typeof action>> | undefined
  >(action, undefined);
  const handlers: Readonly<Record<string, FileSystemDataModule<RouteContext>>> =
    {
      home: { loader: input => input.context.label },
    };
  const selected = selectApplicationDataRoute(
    router,
    request,
    'home',
    'loader',
    handlers,
  );
  const routeValue: unknown = resolveRouteData('home', {
    kind: 'success',
    value: context.label,
    status: 200,
  });
  const failure: ConstructorParameters<typeof RouteDataError>[1] = {
    kind: 'error',
    error: { name: 'Error', message: 'Native route error' },
    status: 500,
    thrown: true,
  };
  const error: RouteDataError = new RouteDataError('home', failure);
  const linkProps: LinkComponentProps<'a', AnyRouter, string, '/'> = {
    to: '/',
    preload: 'intent',
    children: 'Home',
  };
  const anchorProps: Octane.JSX.IntrinsicElements['a'] = {
    href: '/',
    'aria-label': 'Native anchor',
  };
  return {
    router,
    action,
    state,
    submit,
    pending,
    selected,
    routeValue,
    error,
    link: createElement(Link, linkProps),
    outlet: createElement(Outlet, {}),
    application: createElement(ApplicationRouter, { router }),
    anchor: createElement('a', anchorProps, 'Native anchor'),
  };
}
