import { Outlet } from '@modern-js/plugin-tanstack/runtime';

export default function Layout() {
  return (
    <main id="root">
      <Outlet />
    </main>
  );
}
