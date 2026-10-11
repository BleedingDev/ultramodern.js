import { Link, Outlet } from '@modern-js/plugin-tanstack/runtime';
import './index.css';

export default function Layout() {
  return (
    <main data-testid="native-layout">
      <nav aria-label="Fixture navigation">
        <Link to="/" data-testid="nav-home">
          Home
        </Link>
        <Link to="/about" data-testid="nav-about">
          About
        </Link>
        <Link to="/items/$id" params={{ id: '1' }} data-testid="nav-item">
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
