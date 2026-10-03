import { Link, Outlet } from '@bleedingdev/modern-js-renderer-solid/router';
import type { JSX } from '@solidjs/web';
import Stable from '../components/Stable';
import './index.css';

export default function Layout(): JSX.Element {
  return (
    <main data-testid="native-layout">
      <nav aria-label="Fixture navigation">
        <Link to="/">Home</Link>
        <Link to="/about">About</Link>
      </nav>
      <Stable />
      <Outlet />
    </main>
  );
}
