import { Link, Outlet } from '@modern-js/renderer-solid/router';
import type { JSX } from '@solidjs/web';
import './index.css';

export default function Layout(): JSX.Element {
  return (
    <main data-testid="native-layout">
      <nav aria-label="Fixture navigation">
        <Link to="/" data-testid="nav-home">
          Home
        </Link>
        <Link to="/about" data-testid="nav-about">
          About
        </Link>
        <Link to="/items/1" data-testid="nav-item">
          Item
        </Link>
        <Link
          to="/"
          search={{ case: 'deferred' }}
          preload={false}
          data-testid="nav-deferred"
        >
          Deferred
        </Link>
      </nav>
      <Outlet />
    </main>
  );
}
