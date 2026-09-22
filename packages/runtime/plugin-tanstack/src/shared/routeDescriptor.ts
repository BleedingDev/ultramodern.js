import { toTanstackPath } from '../runtime/routeTree/paths';

type RouteShape = {
  id?: string;
  file?: string;
  path?: string;
  index?: boolean;
  isRoot?: boolean;
  children?: RouteShape[];
};

/** Browser-safe structure shared by the executable tree and concrete TS emitter. */
export type RouteDescriptor<T extends RouteShape> = {
  source: T;
  location: { id: string; path?: never } | { path: string; id?: never };
  hasSplat: boolean;
  children: RouteDescriptor<T>[];
};

export function describeRouteTree<T extends RouteShape>(routes: T[]) {
  const root = routes.find(
    route =>
      route.isRoot === true || (route.path === '/' && route.index !== true),
  );
  const describe = (route: T, index: number): RouteDescriptor<T> => ({
    source: route,
    location:
      (route.path ?? '').length === 0 && route.index !== true
        ? { id: route.id || route.file || `pathless-${index}` }
        : {
            path: route.index === true ? '/' : toTanstackPath(route.path || ''),
          },
    hasSplat: Boolean(route.path?.includes('*')),
    children: ((route.children ?? []) as T[]).map(describe),
  });
  return {
    root,
    children: (root !== undefined
      ? [
          ...((root.children ?? []) as T[]),
          ...routes.filter(route => route !== root),
        ]
      : routes
    ).map(describe),
  };
}
