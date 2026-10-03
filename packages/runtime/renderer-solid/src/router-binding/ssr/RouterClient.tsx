import type { JSX } from '@solidjs/web';
import type { AnyRouter } from '@tanstack/router-core';
import { hydrate } from '@tanstack/router-core/ssr/client';
import { Await } from '../awaited';
import { RouterProvider } from '../RouterProvider';

let hydrationPromise: Promise<void> | undefined;

export function RouterClient(props: { router: AnyRouter }): JSX.Element {
  hydrationPromise ??= hydrate(props.router).finally(() => window.$_TSR!.h());

  return (
    <Await
      promise={hydrationPromise}
      children={() => <RouterProvider router={props.router} />}
    />
  );
}
