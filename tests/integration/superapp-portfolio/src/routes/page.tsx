import effectBff from '@api/effect/index';
import { useMatch } from '@modern-js/runtime/tanstack-router';
import { useEffect, useState } from 'react';
import type { PortfolioApp } from '../../shared/portfolio-state.js';

type BootstrapData = Awaited<
  ReturnType<typeof effectBff.client.portfolio.bootstrap>
>;

export default function PortfolioPage() {
  const match = useMatch({ from: '/' });
  const loaderData = match.loaderData!;
  const [data, setData] = useState<BootstrapData | null>(null);

  useEffect(() => {
    effectBff.client.portfolio.bootstrap({}).then(setData);
  }, []);

  return (
    <section data-testid="portfolio-page">
      <div className="panel">
        <h1>Validation Portfolio</h1>
        <div data-testid="route-kind">{loaderData.routeKind}</div>
      </div>

      {data ? (
        <div className="grid" data-testid="portfolio-ready">
          {(data.apps as PortfolioApp[]).map(app => (
            <article
              key={app.id}
              className={`app-card ${app.risk}`}
              data-testid={`portfolio-app-${app.id}`}
            >
              <strong>{app.label}</strong>
              <span>{app.kind}</span>
              <span>routes:{app.routes.length}</span>
              <span>smoke:{app.profiles.smoke.workflows.length}</span>
              <span>stress:{app.profiles.stress.workflows.length}</span>
              <span>nightly:{app.profiles.nightly.workflows.length}</span>
            </article>
          ))}
        </div>
      ) : (
        <div data-testid="portfolio-loading">loading</div>
      )}
    </section>
  );
}
