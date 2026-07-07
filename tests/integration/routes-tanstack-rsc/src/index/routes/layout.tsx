'use client';

import { Link, Outlet } from '@modern-js/plugin-tanstack/runtime';

export default function Layout() {
  return (
    <div id="root-layout">
      <nav>
        <Link to="/" data-testid="link-plain">
          Plain
        </Link>
        <Link to="/composite" data-testid="link-composite">
          Composite
        </Link>
      </nav>
      <Outlet />
    </div>
  );
}
