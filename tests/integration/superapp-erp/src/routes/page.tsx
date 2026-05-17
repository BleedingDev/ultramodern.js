// @effect-diagnostics strictBooleanExpressions:off
import effectBff from '@api/effect/index';
import { useMatch } from '@modern-js/plugin-tanstack/runtime';
import { useEffect, useState } from 'react';
import type { SuperAppModule } from '../../shared/superapp-state.js';

type BootstrapData = Awaited<ReturnType<typeof effectBff.client.erp.bootstrap>>;

export default function DashboardPage() {
  const match = useMatch({ from: '/' });
  const loaderData = match.loaderData!;
  const [data, setData] = useState<BootstrapData | null>(null);

  useEffect(() => {
    effectBff.client.erp.bootstrap({}).then(setData);
  }, []);

  return (
    <section>
      <div className="panel">
        <h1>Command Center</h1>
        <div data-testid="route-kind">{loaderData.routeKind}</div>
        <div data-testid="critical-path">
          {loaderData.criticalPath.join('>')}
        </div>
      </div>

      {data ? (
        <div className="panel" data-testid="dashboard-ready">
          <div data-testid="summary">
            modules:{data.summary.moduleCount};pending:
            {data.summary.pendingApprovals};urgent:{data.summary.urgentMessages}
          </div>
          <div className="grid">
            {(data.modules as SuperAppModule[]).map(module => (
              <div
                key={module.id}
                className={`module ${module.status}`}
                data-testid={`module-${module.id}`}
              >
                <strong>{module.label}</strong>
                <div>status:{module.status}</div>
                <div>open:{module.openWork}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div data-testid="dashboard-loading">loading</div>
      )}
    </section>
  );
}
