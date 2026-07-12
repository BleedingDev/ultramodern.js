import { Link, useRouterState } from '@modern-js/plugin-tanstack/runtime';
import { Outlet } from '@modern-js/runtime/router';
import { useRef } from 'react';

export default function Layout() {
  const location = useRouterState({
    select: state => state.location.href,
  });
  const realmIdentity = useRef('');
  realmIdentity.current ||= crypto.randomUUID();

  return (
    <div
      id="remote-two-runtime-realm"
      data-router-realm={realmIdentity.current}
    >
      <Link
        data-testid="remote-two-native-link"
        to="."
        search={{ remote: 'two' }}
      >
        remote-two-route
      </Link>
      <div id="remote-two-router-location">
        remote-two-router-location:{location}
      </div>
      <Outlet />
    </div>
  );
}
