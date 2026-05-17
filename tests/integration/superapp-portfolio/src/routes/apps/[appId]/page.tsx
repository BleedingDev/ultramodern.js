// @effect-diagnostics asyncFunction:off strictBooleanExpressions:off
import effectBff from '@api/effect/index';
import { useMatch } from '@modern-js/plugin-tanstack/runtime';
import { useEffect, useState } from 'react';
import type { PortfolioApp } from '../../../../shared/portfolio-state.js';

type BootstrapData = Awaited<
  ReturnType<typeof effectBff.client.portfolio.bootstrap>
>;

export default function PortfolioAppPage() {
  const match = useMatch({ from: '/apps/$appId' });
  const loaderData = match.loaderData!;
  const [app, setApp] = useState<PortfolioApp | null>(null);
  const [eventId, setEventId] = useState('pending');

  useEffect(() => {
    effectBff.client.portfolio.bootstrap({}).then((data: BootstrapData) => {
      setApp(
        ((data.apps as PortfolioApp[]).find(
          item => item.id === loaderData.appId,
        ) as PortfolioApp | undefined) ?? null,
      );
    });
  }, [loaderData.appId]);

  const runWorkflow = async () => {
    if (!loaderData.appId) {
      setEventId('unknown-app');
      return;
    }

    const result = await effectBff.client.portfolio.runWorkflow({
      params: {
        appId: loaderData.appId,
      },
      payload: {
        action: app?.profiles.smoke.workflows[0] ?? 'smoke',
        actor: 'browser.operator',
        requestId: `ui-${loaderData.appId}`,
      },
    });
    setEventId(`${result.event.id}:${result.event.status}`);
  };

  return (
    <section className="panel" data-testid="portfolio-app-page">
      <h1>{app?.label ?? loaderData.appId}</h1>
      <div data-testid="app-route-kind">{loaderData.routeKind}</div>
      <div data-testid="app-capabilities">
        capabilities:{loaderData.expectedCapabilities}
      </div>
      <div data-testid="app-profiles">
        smoke:{app?.profiles.smoke.workflows.length ?? 0};stress:
        {app?.profiles.stress.workflows.length ?? 0};nightly:
        {app?.profiles.nightly.workflows.length ?? 0}
      </div>
      <button type="button" data-testid="run-workflow" onClick={runWorkflow}>
        Run workflow
      </button>
      <div data-testid="workflow-event">{eventId}</div>
    </section>
  );
}
