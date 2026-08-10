import { Link, useRouterState } from '@modern-js/plugin-tanstack/runtime';
import { Outlet } from '@modern-js/runtime/router';
import { useId } from 'react';

export default function Layout() {
  const location = useRouterState({
    select: state => state.location.href,
  });
  const realmIdentity = `remote-one:${useId()}`;

  return (
    <div id="remote-one-runtime-realm" data-router-realm={realmIdentity}>
      <Link
        data-testid="remote-one-native-link"
        to="."
        search={{ remote: 'one' }}
      >
        remote-one-route
      </Link>
      <div id="remote-one-router-location">
        remote-one-router-location:{location}
      </div>
      <Outlet />
    </div>
  );
}
