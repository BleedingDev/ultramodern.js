import { Link, Outlet, useMatch } from '@modern-js/plugin-tanstack/runtime';
import './style.css';

export default function Layout() {
  const match = useMatch({ from: '__root__' });
  const loaderData = match.loaderData!;

  return (
    <main className="portfolio-shell" data-testid="portfolio-shell">
      <aside className="portfolio-nav">
        <div className="brand">SuperApp Portfolio</div>
        <div data-testid="shell-mode">{loaderData.shellMode}</div>
        <nav>
          <Link to="/" data-testid="nav-portfolio">
            Portfolio
          </Link>
          <Link
            to="/apps/$appId"
            params={{ appId: 'mobility-marketplace' }}
            data-testid="nav-mobility"
          >
            Mobility
          </Link>
          <Link
            to="/apps/$appId"
            params={{ appId: 'enterprise-mega-erp' }}
            data-testid="nav-mega-erp"
          >
            MegaERP
          </Link>
          <Link
            to="/apps/$appId"
            params={{ appId: 'mf-platform' }}
            data-testid="nav-mf-platform"
          >
            MF Platform
          </Link>
          <Link
            to="/apps/$appId"
            params={{ appId: 'failure-lab' }}
            data-testid="nav-failure-lab"
          >
            Failure Lab
          </Link>
        </nav>
      </aside>
      <section className="portfolio-workspace">
        <header>
          <span data-testid="summary-apps">
            apps:{loaderData.summary.appCount}
          </span>
          <span data-testid="summary-nightly">
            nightly:{loaderData.summary.nightlyWorkflowCount}
          </span>
        </header>
        <Outlet />
      </section>
    </main>
  );
}
