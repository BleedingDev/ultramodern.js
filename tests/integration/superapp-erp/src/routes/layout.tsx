import { Link, Outlet, useMatch } from '@modern-js/plugin-tanstack/runtime';
import './style.css';

export default function Layout() {
  const match = useMatch({ from: '__root__' });
  const loaderData = match.loaderData!;

  return (
    <main className="shell" data-testid="superapp-shell">
      <aside className="sidebar">
        <div className="brand" data-testid="tenant-name">
          {loaderData.tenantName}
        </div>
        <div className="region" data-testid="tenant-region">
          {loaderData.region}
        </div>
        <nav className="nav">
          <Link to="/" data-testid="nav-dashboard">
            Command
          </Link>
          <Link to="/approvals" data-testid="nav-approvals">
            Approvals
          </Link>
          <Link to="/chat" data-testid="nav-chat">
            Chat
          </Link>
        </nav>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <span data-testid="shell-mode">{loaderData.shellMode}</span>
          <span data-testid="shell-open-work">
            open-work:{loaderData.summary.totalOpenWork}
          </span>
        </header>
        <Outlet />
      </section>
    </main>
  );
}
