import type { JSX } from '@solidjs/web';
import type { AnyRouter } from '@tanstack/router-core';
import { RouterProvider } from '../RouterProvider';

export function RouterServer<TRouter extends AnyRouter>(props: {
  router: TRouter;
}): JSX.Element {
  return <RouterProvider router={props.router} />;
}
