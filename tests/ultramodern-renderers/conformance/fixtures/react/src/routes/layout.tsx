import { Link, Outlet } from '@bleedingdev/modern-js-plugin-tanstack/runtime';
import Stable from '../components/Stable';
import './index.css';

export default function Layout() {
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
