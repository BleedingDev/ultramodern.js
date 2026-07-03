import { createMemoryHistory } from '@tanstack/history';
import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
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

  return { anchor, ...utils };
}

describe('tanstack prefetch link adapter - aria-current override', () => {
  it('defaults active link to aria-current="page" when caller passes nothing', async () => {
    const { anchor } = await renderLink({ initialPath: '/settings' });
    expect(anchor.getAttribute('aria-current')).toBe('page');
  });

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

  it('leaves an inactive link untouched when caller passes nothing', async () => {
    const { anchor } = await renderLink({ initialPath: '/' });
    expect(anchor.hasAttribute('aria-current')).toBe(false);
    expect(anchor.getAttribute('data-status')).not.toBe('active');
  });

  it('resolves render-prop children with the active state like TanStack Link', async () => {
    const { anchor } = await renderLink({
      initialPath: '/settings',
      children: ({ isActive }: { isActive: boolean }) =>
        isActive ? 'Active settings' : 'Settings',
    });
    expect(anchor.textContent).toBe('Active settings');
  });

  it('resolves render-prop children as inactive on a non-matching route', async () => {
    const { anchor } = await renderLink({
      initialPath: '/',
      children: ({ isActive }: { isActive: boolean }) =>
        isActive ? 'Active settings' : 'Settings',
    });
    expect(anchor.textContent).toBe('Settings');
  });
});
