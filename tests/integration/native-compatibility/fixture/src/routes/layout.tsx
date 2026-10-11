import { Link, Outlet } from '@modern-js/runtime/router';

export default function Layout() {
  return (
    <main>
      <h1>Native Modern.js contract</h1>
      <Link id="greeting-link" to="/greeting">
        Read greeting
      </Link>
      <Outlet />
    </main>
  );
}
