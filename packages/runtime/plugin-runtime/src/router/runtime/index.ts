import { useRouteLoaderData as useRouteData } from '@modern-js/runtime-utils/router';

export * from '@modern-js/runtime-utils/router';
export type { LinkProps, NavLinkProps } from './PrefetchLink';
export { Link, NavLink } from './PrefetchLink';

export const useRouteLoaderData: typeof useRouteData = (routeId: string) => {
  const realRouteId = routeId.replace(/\[(.*?)\]/g, '($1)');
  return useRouteData(realRouteId);
};

export type { LoaderFunction, LoaderFunctionArgs } from './types';
export * from './withRouter';
