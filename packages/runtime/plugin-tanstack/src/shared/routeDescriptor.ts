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

const isPathless = (route: RouteShape) =>
  (route.path ?? '').length === 0 && route.index !== true;

const toLocationPath = (route: RouteShape) =>
  route.index === true ? '/' : toTanstackPath(route.path || '');

const joinPath = (parent: string, path: string) =>
  `${parent}/${path}`.replace(/\/{2,}/g, '/');

function collectFullPaths(
  routes: RouteShape[],
  parentPath: string,
  fullPaths: string[],
) {
  for (const route of routes) {
    let fullPath = parentPath;
    if (!isPathless(route)) {
      fullPath = joinPath(parentPath, toLocationPath(route));
      fullPaths.push(fullPath);
    }
    collectFullPaths(route.children ?? [], fullPath, fullPaths);
  }
}

/**
 * Modern flattens layout-less directories into prefixed routes, so
 * `[lang]/page.tsx` and `[lang]/$.tsx` become the routes `:lang` and
 * `:lang/*`. TanStack matches `/en` to the splat unless the plain leaf is
 * declared as the index of that prefix (`$lang/`). A leaf is that index when
 * any other route lives below its full path, including routes nested under
 * pathless layouts, because TanStack matches across those layouts.
 */
const isPrefixIndex = (fullPath: string, fullPaths: string[]) =>
  !fullPath.endsWith('/') &&
  fullPaths.some(
    other =>
      other.startsWith(`${fullPath}/`) && other.length > fullPath.length + 1,
  );

export function describeRouteTree<T extends RouteShape>(routes: T[]) {
  const root = routes.find(
    route =>
      route.isRoot === true || (route.path === '/' && route.index !== true),
  );
  const topLevel =
    root !== undefined
      ? [
          ...((root.children ?? []) as T[]),
          ...routes.filter(route => route !== root),
        ]
      : routes;
  const fullPaths: string[] = [];
  collectFullPaths(topLevel, '', fullPaths);

  const describe =
    (parentPath: string) =>
    (route: T, index: number): RouteDescriptor<T> => {
      const children = (route.children ?? []) as T[];
      if (isPathless(route)) {
        return {
          source: route,
          location: { id: route.id || route.file || `pathless-${index}` },
          hasSplat: false,
          children: children.map(describe(parentPath)),
        };
      }
      const path = toLocationPath(route);
      const fullPath = joinPath(parentPath, path);
      return {
        source: route,
        location: {
          path:
            children.length === 0 && isPrefixIndex(fullPath, fullPaths)
              ? `${path}/`
              : path,
        },
        hasSplat: Boolean(route.path?.includes('*')),
        children: children.map(describe(fullPath)),
      };
    };

  return { root, children: topLevel.map(describe('')) };
}
