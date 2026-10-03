import type { RendererIdentity } from '@bleedingdev/modern-js-renderer-core/identity';
import {
  ActionForm,
  type AnyRouter,
  ApplicationRouter,
  createApplicationRouter,
  createFileSystemRouteTree,
  createMemoryHistory,
  createRouteAction,
  type ErrorRouteComponent,
  type FileSystemDataModule,
  type FileSystemRouteModule,
  type FileSystemRouteOptions,
  Link,
  type NotFoundRouteComponent,
  Outlet,
  type RouteAction,
  type RouteActionOptions,
  type RouteComponent,
  RouteDataError,
  resolveRouteData,
  selectApplicationDataRoute,
  useLoaderData,
  useRouteAction,
} from '@bleedingdev/modern-js-renderer-solid/router';
import type { JSX } from '@solidjs/web';

interface RouteContext {
  label: string;
}

export function routerPublicProgram(
  request: Request,
  identity: RendererIdentity,
) {
  const Page: RouteComponent = () => {
    const data = useLoaderData({ strict: false });
    const action: RouteAction = useRouteAction();
    return (
      <section>
        <Link to="/">Home</Link>
        <pre>{JSON.stringify(data())}</pre>
        <ActionForm action={action}>
          <input name="label" />
          <button type="submit" disabled={action.pending()}>
            Save
          </button>
        </ActionForm>
      </section>
    );
  };
  const ErrorPage: ErrorRouteComponent = props => (
    <p>
      {props.error instanceof Error ? props.error.message : String(props.error)}
    </p>
  );
  const MissingPage: NotFoundRouteComponent = () => <p>Missing route</p>;
  const routes: Parameters<typeof createFileSystemRouteTree>[0] = [
    {
      id: 'root',
      isRoot: true,
      children: [
        {
          id: 'home',
          index: true,
          modules: { data: 'home.data.ts' },
          children: [],
        },
      ],
    },
  ];
  const modules: Readonly<Record<string, FileSystemRouteModule>> = {
    root: { component: Outlet },
    home: {
      component: Page,
      pendingComponent: () => <p>Loading</p>,
      errorComponent: ErrorPage,
      notFoundComponent: MissingPage,
      context: () => ({ source: 'native-public-context' }),
      beforeLoad: () => ({ ready: true }),
      head: () => ({ meta: [{ title: 'Native public router' }] }),
      validateSearch: ({ label }) => ({ label }),
    },
  };
  const options: FileSystemRouteOptions<RouteContext> = {
    request,
    context: { label: 'Native route data' },
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
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { ultramodern: { rendererIdentity: identity } },
    isServer: false,
  });
  const actionOptions: RouteActionOptions = {
    router,
    routeId: 'home',
    rendererIdentity: identity,
    url: request.url,
  };
  const action: RouteAction = createRouteAction(actionOptions);
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
  const value: unknown = resolveRouteData('home', {
    kind: 'success',
    value: 'Native public result',
    status: 200,
  });
  const error: RouteDataError = new RouteDataError('home', {
    kind: 'error',
    error: { name: 'Error', message: 'Native route error' },
    status: 500,
    thrown: true,
  });
  const view: () => JSX.Element = () => <ApplicationRouter router={router} />;
  return { router, action, selected, value, error, view };
}
