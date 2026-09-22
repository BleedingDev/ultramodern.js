import { createMemoryHistory } from '@tanstack/history';
import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, render, waitFor } from '@testing-library/react';
import React from 'react';
import { createTanstackNavigation } from '../../src/runtime/navigation';
import { Link, NavLink } from '../../src/runtime/prefetchLink';

// Real-router harness (no module mocking): STATIC_ACTIVE_PROPS (the
// TanStack behavior this adapter works around) is injected by
// useLinkProps() based on live route match state, which a mocked
// useLinkProps() cannot reproduce faithfully. We tried spying on
// useLinkProps via rstest.mock()+importActual while re-exporting the rest
// of the module untouched, but rstest's module-mock hoisting resolves the
// "actual" import for a module through its own in-progress mock
// registration, so every named export (createRootRoute included) comes
// back undefined -- see the sibling prefetchLinkPreload.test.tsx file for
// the fully-mocked preload-mapping coverage instead. This file renders
// through an actual createRouter()/RouterProvider tree with in-memory
// history so the active/inactive aria-current behavior is exercised for
// real.
function buildRouter(options: {
  initialPath: string;
  linkProps?: Record<string, unknown>;
  useNavLink?: boolean;
  children?:
    | React.ReactNode
    | ((state: { isActive: boolean }) => React.ReactNode);
}) {
  // The Link lives on the always-rendered root component (not a route
  // that's only matched at "/settings") so the "inactive link" case -
  // sitting at "/" while linking to "/settings" - actually mounts it.
  const rootRoute = createRootRoute({
    component: () => {
      const Component = options.useNavLink ? NavLink : Link;
      return (
        <Component to="/settings" {...(options.linkProps ?? {})}>
          {options.children ?? 'Settings'}
        </Component>
      );
    },
  });
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

  const routeTree = rootRoute.addChildren([homeRoute, settingsRoute]);

  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [options.initialPath] }),
  });
}

async function renderLink(options: Parameters<typeof buildRouter>[0]) {
  const router = buildRouter(options);
  const utils = render(<RouterProvider router={router} />);

  const anchor = await waitFor(() => {
    const found = utils.container.querySelector('a[href="/settings"]');
    if (!found) {
      throw new Error('anchor not rendered yet');
    }
    return found as HTMLAnchorElement;
  });

  return { anchor, router, ...utils };
}

describe('tanstack prefetch link adapter - aria-current override', () => {
  it('lets caller aria-current="true" win over the TanStack-forced value', async () => {
    const { anchor } = await renderLink({
      initialPath: '/settings',
      linkProps: { 'aria-current': 'true' },
    });
    expect(anchor.getAttribute('aria-current')).toBe('true');
    expect(anchor.outerHTML.match(/aria-current=/g)).toHaveLength(1);
  });

  it('suppresses aria-current entirely when caller passes false', async () => {
    const { anchor } = await renderLink({
      initialPath: '/settings',
      linkProps: { 'aria-current': false },
    });
    expect(anchor.hasAttribute('aria-current')).toBe(false);
  });

  it('updates render-prop children across an inactive-to-active transition', async () => {
    const { anchor, router } = await renderLink({
      initialPath: '/',
      children: ({ isActive }: { isActive: boolean }) =>
        isActive ? 'Active settings' : 'Settings',
    });

    expect(anchor.textContent).toBe('Settings');

    await act(async () => {
      await router.navigate({ to: '/settings' });
    });

    await waitFor(() => expect(anchor.textContent).toBe('Active settings'));
  });

  it('passes the native anchor ref through the router hook', async () => {
    const ref = React.createRef<HTMLAnchorElement>();
    const { anchor } = await renderLink({
      initialPath: '/',
      linkProps: { ref, prefetch: 'none' },
    });
    expect(ref.current).toBe(anchor);
  });
});

test('provider navigation observes native navigation and preserves history state', async () => {
  const { router, unmount } = await renderLink({ initialPath: '/' });
  const capability = createTanstackNavigation(router);
  const initial = capability.getSnapshot();
  expect(capability.getSnapshot()).toBe(initial);
  const listener = rstest.fn();
  const stop = capability.subscribe(listener);
  await act(() =>
    capability.navigate('/settings?q=two#detail', {
      replace: true,
      state: { custom: true },
    }),
  );
  expect(listener).toHaveBeenCalled();
  expect(capability.getSnapshot().location).toEqual({
    pathname: '/settings',
    search: '?q=two',
    hash: '#detail',
  });
  expect(router.state.location.state).toMatchObject({ custom: true });
  expect(router.history.length).toBe(1);
  stop();
  listener.mockClear();
  await act(() => capability.navigate('/'));
  expect(listener).not.toHaveBeenCalled();
  unmount();
});
