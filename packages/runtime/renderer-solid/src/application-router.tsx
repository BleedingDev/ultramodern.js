import { DataProtocolError } from '@modern-js/renderer-core/data';
import { type JSX, useHead } from '@solidjs/web';
import type { AnyRouter, RegisteredRouter } from '@tanstack/router-core';
import { ownApplicationRouteData } from './route-completion';
import { toHeadTags, useTags } from './router-binding/headContentUtils';
import { Matches } from './router-binding/Matches';
import {
  RouterContextProvider,
  type RouterProps,
} from './router-binding/RouterProvider';

function ApplicationHead(): null {
  const tags = useTags();
  // The application document owns Solid's hydration bootstrap. Register route
  // metadata through the native head registry without emitting a second script.
  useHead(() => toHeadTags(tags()));
  return null;
}

/** Native routing and head hooks share the same request/application provider. */
export function ApplicationRouter<
  TRouter extends AnyRouter = RegisteredRouter,
  TDehydrated extends Record<string, unknown> = Record<string, unknown>,
>(props: Omit<RouterProps<TRouter, TDehydrated>, 'context'>): JSX.Element {
  if (Object.hasOwn(props, 'context'))
    throw new DataProtocolError(
      'Set public Solid router context in createApplicationRouter; ApplicationRouter context overrides are unsupported',
    );
  const { router, ...rest } = props;
  ownApplicationRouteData(router);
  return (
    <RouterContextProvider router={router} {...rest}>
      {() => (
        <>
          <ApplicationHead />
          <Matches />
        </>
      )}
    </RouterContextProvider>
  );
}
