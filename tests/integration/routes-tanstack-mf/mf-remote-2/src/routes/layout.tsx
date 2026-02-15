import { Outlet } from '@modern-js/runtime/router';

export default function Layout() {
  return (
    <div id="remote2-root">
      <Outlet />
    </div>
  );
}
