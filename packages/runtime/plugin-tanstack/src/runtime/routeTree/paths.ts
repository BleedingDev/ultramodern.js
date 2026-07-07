// @effect-diagnostics asyncFunction:off strictBooleanExpressions:off

import type { RouteObject } from '@modern-js/runtime-utils/router';

export function toTanstackPath(pathname: string): string {
  // TanStack Router uses `$param` and `$` (splat) style params.
  // Modern's conventional routing currently generates React Router style params (e.g. `:id`, `*`).
  //
  // We only convert the subset Modern generates today:
  // - `:id` -> `$id`
  // - `:id?` -> `{-$id}` (optional param)
  // - `*`   -> `$`
  return pathname
    .split('/')
    .map(segment => {
      if (!segment) {
        return segment;
      }
      if (segment === '*') {
        return '$';
      }
      if (segment.startsWith(':')) {
        const name = segment.slice(1);
        if (name.endsWith('?')) {
          return `{-$${name.slice(0, -1)}}`;
        }
        return `$${name}`;
      }
      return segment;
    })
    .join('/');
}

export function isRouteObjectPathlessLayout(route: RouteObject) {
  return !route.path && !route.index;
}
