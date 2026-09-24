import { createMemoryHistory } from '@tanstack/history';
import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { useMatches } from '../../src/runtime/routeHooks';
import { navigateOnClient } from './clientNavigation';

function MatchIds() {
  const matches = useMatches();
  return React.createElement(
    'output',
    { 'data-testid': 'route-ids' },
    matches.map(match => match.routeId).join(','),
  );
}

test('updates whole match objects after navigation with the structural-sharing guard', async () => {
  const rootRoute = createRootRoute({ component: MatchIds });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => null,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings',
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([homeRoute, settingsRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    defaultStructuralSharing: true,
  });

  await router.load();
  expect(
    renderToString(React.createElement(RouterProvider, { router })),
  ).toContain('__root__');

  await navigateOnClient(router, { to: '/settings' });

  expect(
    renderToString(React.createElement(RouterProvider, { router })),
  ).toContain('/settings');
});
